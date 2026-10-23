import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { parsePgn, splitPgnGames, stripNagsAfterComments } from "./pgn";
import { primaryLineOf } from "./export";

const GAME_A = `[Event "A"]
[Site "x"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

const GAME_B = `[Event "B"]
[White "Alice"]
[Black "Bob"]
[Result "0-1"]

1. d4 d5 2. c4 e6 0-1`;

describe("splitPgnGames", () => {
  it("splits a concatenated multi-game file that chess.js itself rejects", () => {
    const file = `${GAME_A}\n\n${GAME_B}\n`;
    expect(() => new Chess().loadPgn(file)).toThrow();

    const games = splitPgnGames(file);
    expect(games).toHaveLength(2);
    for (const game of games) {
      expect(() => new Chess().loadPgn(game)).not.toThrow();
    }
  });

  it("does not split a single game at its own header/movetext boundary", () => {
    // That boundary is also a blank line -- only the `[` lookahead keeps it from splitting.
    expect(splitPgnGames(GAME_A)).toEqual([GAME_A]);
  });

  it("splits a CRLF file", () => {
    const file = `${GAME_A}\n\n${GAME_B}`.replace(/\n/g, "\r\n");
    expect(splitPgnGames(file)).toHaveLength(2);
  });

  it("ignores blank padding between and around games", () => {
    expect(splitPgnGames(`\n\n${GAME_A}\n\n\n  \n${GAME_B}\n\n`)).toHaveLength(2);
  });

  it("returns nothing for an empty file", () => {
    expect(splitPgnGames("   \n\n ")).toEqual([]);
  });
});

describe("stripNagsAfterComments", () => {
  it("removes the NAG sequence that breaks the chess.js parser", () => {
    const pgn = `[Event "N"]\n\n1. e4 {good move} $1 e5 *`;
    expect(() => new Chess().loadPgn(pgn)).toThrow();

    const { text, strippedNags } = stripNagsAfterComments(pgn);
    expect(strippedNags).toBe(1);
    expect(() => new Chess().loadPgn(text)).not.toThrow();
  });

  it("removes a run of NAGs after one comment", () => {
    const { text, strippedNags } = stripNagsAfterComments("1. e4 {x} $1 $18 e5 *");
    expect(strippedNags).toBe(2);
    expect(text).toBe("1. e4 {x} e5 *");
  });

  it("leaves NAGs that do not follow a comment alone -- those already parse", () => {
    const pgn = `[Event "N"]\n\n1. e4 $1 e5 2. Nf3 $2 {develops} Nc6 *`;
    const { text, strippedNags } = stripNagsAfterComments(pgn);
    expect(strippedNags).toBe(0);
    expect(text).toBe(pgn);
    expect(() => new Chess().loadPgn(text)).not.toThrow();
  });

  it("is idempotent", () => {
    const once = stripNagsAfterComments("1. e4 {x} $1 e5 *").text;
    expect(stripNagsAfterComments(once).text).toBe(once);
  });
});

describe("parsePgn", () => {
  it("imports a multi-game file as N records", () => {
    const result = parsePgn(`${GAME_A}\n\n${GAME_B}`, { mode: "WHOLE_GAME" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.records).toHaveLength(2);
    expect(result.records.every((record) => record.ok)).toBe(true);
  });

  it("imports a {comment} $NAG game and reports the stripped NAG", () => {
    const result = parsePgn(`[Event "N"]\n\n1. e4 {good} $1 e5 *`, { mode: "WHOLE_GAME" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [record] = result.records;
    expect(record?.ok).toBe(true);
    if (!record?.ok) return;

    expect(primaryLineOf(record.candidate.moves)).toEqual(["e4", "e5"]);
    expect(record.candidate.notes.join(" ")).toContain("NAG");
  });

  it("reports that variations were dropped rather than losing them silently", () => {
    const result = parsePgn(`[Event "V"]\n\n1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 *`, {
      mode: "WHOLE_GAME",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");
    expect(primaryLineOf(record.candidate.moves)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(record.candidate.notes.join(" ")).toContain("Variations were dropped");
  });

  it("starts the solution at the selected ply in EXTRACT_PLIES mode", () => {
    const result = parsePgn(GAME_A, { mode: "EXTRACT_PLIES", plies: [6] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");
    expect(primaryLineOf(record.candidate.moves)).toEqual(["Qxf7#"]);
    expect(new Chess(record.candidate.fen).turn()).toBe("w");
  });

  it("alternates SOLVER and OPPONENT from the puzzle's starting position", () => {
    const result = parsePgn(GAME_A, { mode: "EXTRACT_PLIES", plies: [2] });
    if (!result.ok) throw new Error("expected a parsed file");
    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");

    const actors: string[] = [];
    let level = record.candidate.moves;
    while (level[0]) {
      actors.push(level[0].actor);
      level = level[0].children;
    }
    expect(actors).toEqual(["SOLVER", "OPPONENT", "SOLVER", "OPPONENT", "SOLVER"]);
  });

  it("rejects an out-of-range ply without aborting the file", () => {
    const result = parsePgn(GAME_A, { mode: "EXTRACT_PLIES", plies: [0, 99] });
    if (!result.ok) throw new Error("expected a parsed file");

    expect(result.records[0]?.ok).toBe(true);
    const bad = result.records[1];
    expect(bad?.ok).toBe(false);
    if (bad?.ok === false) {
      expect(bad.message).toContain("out of range");
    }
  });

  it("keeps good games when one game in the file is malformed", () => {
    const broken = `[Event "Broken"]\n\n1. zz9 *`;
    const result = parsePgn(`${GAME_A}\n\n${broken}\n\n${GAME_B}`, { mode: "WHOLE_GAME" });
    if (!result.ok) throw new Error("expected a parsed file");

    expect(result.records.map((record) => record.ok)).toEqual([true, false, true]);
  });

  it("honours a [FEN] header as the puzzle's starting position", () => {
    const fen = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
    const result = parsePgn(`[Event "F"]\n[FEN "${fen}"]\n[SetUp "1"]\n\n1. Ra8# 1-0`, {
      mode: "WHOLE_GAME",
    });
    if (!result.ok) throw new Error("expected a parsed file");
    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");

    expect(record.candidate.fen).toBe(fen);
  });

  it("carries move comments onto the tree nodes", () => {
    const result = parsePgn(`[Event "C"]\n\n1. e4 {best by test} e5 *`, { mode: "WHOLE_GAME" });
    if (!result.ok) throw new Error("expected a parsed file");
    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");

    expect(record.candidate.moves[0]?.comment).toBe("best by test");
  });

  it("builds a source string from the game headers", () => {
    const result = parsePgn(GAME_B, { mode: "WHOLE_GAME" });
    if (!result.ok) throw new Error("expected a parsed file");
    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");

    expect(record.candidate.source).toBe("B, Alice vs Bob");
  });

  it("fails the whole file when there is no PGN in it", () => {
    expect(parsePgn("   ", { mode: "WHOLE_GAME" })).toEqual({
      ok: false,
      message: "No PGN games found in file",
    });
  });

  it("rejects a game with no moves", () => {
    const result = parsePgn(`[Event "E"]\n[Result "*"]\n\n*`, { mode: "WHOLE_GAME" });
    if (!result.ok) throw new Error("expected a parsed file");
    expect(result.records[0]).toMatchObject({ ok: false, message: "Game contains no moves" });
  });
});
