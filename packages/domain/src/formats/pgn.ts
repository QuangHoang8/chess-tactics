import { Chess } from "chess.js";
import type { SolutionTreeInput } from "../chess/types";
import type { ImportCandidate, ParseResult, ParsedRecord, PgnImportOptions } from "./types";

/** PGN carries no difficulty rating, so imported games land in the middle of the 1-5 scale. */
const PGN_DEFAULT_DIFFICULTY = 3;

/** chess.js fills absent headers with these placeholders; they are noise in a `source` string. */
const HEADER_PLACEHOLDERS = new Set(["?", "????.??.??", "*", "-"]);

/**
 * chess.js 1.4.0's `loadPgn` accepts exactly one game and throws
 * `Expected end of input or whitespace but "[" found` on a concatenated file (plan §3.1,
 * re-verified against the installed version). A new game therefore starts at the first tag
 * line after a blank line.
 *
 * The lookahead is what stops this over-splitting a *single* game at its own
 * header/movetext boundary -- that blank line is followed by movetext (`1.`), not `[`.
 */
export function splitPgnGames(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n(?=[ \t]*\[)/)
    .map((game) => game.trim())
    .filter((game) => game.length > 0);
}

/**
 * A comment immediately followed by a NAG (`{good} $1`) is the one PGN sequence chess.js 1.4.0's
 * parser rejects (plan §3.1). The reverse order (`$1 {good}`) and a bare NAG both parse, so only
 * the offending NAGs are dropped.
 *
 * Stripping rather than reordering: a run of NAGs after one comment (`{x} $1 $2`) and nested
 * braces both make reordering a parser's job, while stripping is one pass and idempotent. NAGs
 * are not part of the §4 data model, so nothing persisted is lost -- but the count is reported.
 *
 * The gap spans `\s`, not just spaces and tabs: exported PGN wraps movetext at around 80 columns
 * and the wrap lands between `}` and `$1` often enough to matter. Anything else between them --
 * a move, a move number -- is non-whitespace, so this cannot reach across to a later move's NAG.
 */
export function stripNagsAfterComments(text: string): { text: string; strippedNags: number } {
  let strippedNags = 0;
  const stripped = text.replace(/\}(?:\s*\$\d+)+/g, (match) => {
    strippedNags += (match.match(/\$\d+/g) ?? []).length;
    return "}";
  });
  return { text: stripped, strippedNags };
}

/**
 * Parses a PGN file into import candidates. Never throws: a game chess.js rejects becomes a
 * rejected record so the rest of the file still imports (plan §6).
 */
export function parsePgn(text: string, options: PgnImportOptions): ParseResult {
  const games = splitPgnGames(text);
  if (games.length === 0) {
    return { ok: false, message: "No PGN games found in file" };
  }

  const records: ParsedRecord[] = [];
  for (const game of games) {
    for (const record of parseGame(game, options, records.length)) {
      records.push(record);
    }
  }
  return { ok: true, records };
}

function parseGame(game: string, options: PgnImportOptions, firstIndex: number): ParsedRecord[] {
  const { text, strippedNags } = stripNagsAfterComments(game);

  const chess = new Chess();
  try {
    chess.loadPgn(text);
  } catch (error) {
    return [{ index: firstIndex, ok: false, message: messageOf(error) }];
  }

  const history = chess.history({ verbose: true });
  if (history.length === 0) {
    return [{ index: firstIndex, ok: false, message: "Game contains no moves" }];
  }

  const notes = gameNotes(game, strippedNags);
  const source = sourceFromHeaders(chess.getHeaders());
  const comments = new Map(chess.getComments().map((entry) => [entry.fen, entry.comment]));

  const startPlies =
    options.mode === "WHOLE_GAME" ? [0] : [...new Set(options.plies ?? [])].sort((a, b) => a - b);

  if (startPlies.length === 0) {
    return [{ index: firstIndex, ok: false, message: "EXTRACT_PLIES requires at least one ply" }];
  }

  return startPlies.map((ply, offset) => {
    const index = firstIndex + offset;
    const start = history[ply];
    if (!start) {
      return {
        index,
        ok: false,
        message: `Ply ${ply} is out of range; the game has ${history.length} plies`,
      };
    }

    const candidate: ImportCandidate = {
      fen: start.before,
      difficulty: PGN_DEFAULT_DIFFICULTY,
      themes: [],
      tags: [],
      ...(source !== undefined ? { source } : {}),
      moves: linearTree(history.slice(ply), comments),
      notes,
    };
    return { index, ok: true, candidate };
  });
}

/**
 * `history()` returns the mainline only -- chess.js parses variations without error and then
 * discards them (plan §3.1). The user is told, rather than left to discover it.
 */
function gameNotes(rawGame: string, strippedNags: number): string[] {
  const notes: string[] = [];
  if (/\(\s*\d+\s*\.{1,3}/.test(rawGame)) {
    notes.push("Variations were dropped; only the mainline was imported");
  }
  if (strippedNags > 0) {
    notes.push(`${strippedNags} NAG annotation(s) following a comment were stripped to parse`);
  }
  return notes;
}

/** The solver moves first by definition, so actors alternate from the puzzle's starting FEN. */
function linearTree(
  moves: { san: string; after: string }[],
  comments: Map<string, string>,
  depth = 0,
): SolutionTreeInput[] {
  const head = moves[depth];
  if (!head) {
    return [];
  }
  const comment = comments.get(head.after);
  return [
    {
      san: head.san,
      actor: depth % 2 === 0 ? "SOLVER" : "OPPONENT",
      isPrimary: true,
      ...(comment !== undefined ? { comment } : {}),
      children: linearTree(moves, comments, depth + 1),
    },
  ];
}

function sourceFromHeaders(headers: Record<string, string>): string | undefined {
  const named = (key: string): string | undefined => {
    const value = headers[key]?.trim();
    return value && !HEADER_PLACEHOLDERS.has(value) ? value : undefined;
  };

  const players = [named("White"), named("Black")].filter((name) => name !== undefined);
  const parts = [
    named("Event"),
    players.length === 2 ? players.join(" vs ") : undefined,
    named("Date"),
  ].filter((part) => part !== undefined);

  return parts.length > 0 ? parts.join(", ") : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Could not parse PGN game";
}
