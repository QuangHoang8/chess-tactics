import type { Actor, SolutionTreeInput } from "../chess/types";
import type { ImportCandidate, ParseResult, ParsedRecord } from "./types";

/**
 * The canonical JSON format (plan §5 3.1, documented in docs/formats.md): either a bare array of
 * puzzles, or the `{puzzles: [...]}` envelope that `GET /puzzles/export?format=json` emits -- so
 * an export file re-imports without being edited first.
 *
 * Structural checking is hand-rolled rather than delegated to Zod because packages/domain is
 * dependency-free by design (it is also consumed by apps/web), and because a per-record message
 * is what the §4.5 import report shows the user.
 */
export function parseJsonImport(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Invalid JSON" };
  }

  const puzzles = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed["puzzles"])
      ? parsed["puzzles"]
      : null;

  if (!puzzles) {
    return { ok: false, message: 'Expected a JSON array of puzzles, or an object with a "puzzles" array' };
  }

  return { ok: true, records: puzzles.map(toRecord) };
}

function toRecord(raw: unknown, index: number): ParsedRecord {
  if (!isRecord(raw)) {
    return { index, ok: false, message: "Expected an object" };
  }

  const fen = raw["fen"];
  if (typeof fen !== "string" || fen.trim() === "") {
    return { index, ok: false, message: "fen must be a non-empty string" };
  }

  const difficulty = raw["difficulty"];
  if (typeof difficulty !== "number" || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
    return { index, ok: false, message: "difficulty must be an integer 1-5" };
  }

  const themes = stringArrayOrNull(raw["themes"] ?? []);
  const tags = stringArrayOrNull(raw["tags"] ?? []);
  if (!themes || !tags) {
    return { index, ok: false, message: "themes and tags must be arrays of strings" };
  }

  const source = optionalString(raw["source"]);
  const explanation = optionalString(raw["explanation"]);
  if (source === false || explanation === false) {
    return { index, ok: false, message: "source and explanation must be strings when present" };
  }

  const moves = treeOrNull(raw["moves"]);
  if (!moves) {
    return {
      index,
      ok: false,
      message: "moves must be an array of {san, actor, isPrimary, comment?, children[]} nodes",
    };
  }

  const candidate: ImportCandidate = {
    fen: fen.trim(),
    difficulty,
    themes,
    tags,
    ...(source !== undefined ? { source } : {}),
    ...(explanation !== undefined ? { explanation } : {}),
    moves,
    notes: [],
  };
  return { index, ok: true, candidate };
}

function treeOrNull(raw: unknown): SolutionTreeInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const nodes: SolutionTreeInput[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      return null;
    }
    const san = entry["san"];
    const actor = entry["actor"];
    const isPrimary = entry["isPrimary"];
    if (typeof san !== "string" || san === "" || !isActor(actor) || typeof isPrimary !== "boolean") {
      return null;
    }
    const comment = optionalString(entry["comment"]);
    if (comment === false) {
      return null;
    }
    // A leaf may legitimately omit `children`; anything present must still be a valid subtree.
    const rawChildren = entry["children"];
    const children =
      rawChildren === undefined || (Array.isArray(rawChildren) && rawChildren.length === 0)
        ? []
        : treeOrNull(rawChildren);
    if (!children) {
      return null;
    }

    nodes.push({
      san,
      actor,
      isPrimary,
      ...(comment !== undefined ? { comment } : {}),
      children,
    });
  }
  return nodes;
}

function isActor(value: unknown): value is Actor {
  return value === "SOLVER" || value === "OPPONENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArrayOrNull(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

/** `false` means "present but not a string"; `undefined` means absent. */
function optionalString(value: unknown): string | undefined | false {
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === "string" ? value : false;
}
