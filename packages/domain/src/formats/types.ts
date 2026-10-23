import type { SolutionTreeInput } from "../chess/types";

/**
 * One puzzle as it arrives from a file, before validation or persistence. Mirrors the
 * `POST /puzzles` body (plan §4.5) so an imported record and a hand-authored one take the
 * identical validation path.
 */
export interface ImportCandidate {
  fen: string;
  difficulty: number;
  themes: string[];
  tags: string[];
  source?: string;
  explanation?: string;
  moves: SolutionTreeInput[];
  /**
   * Non-fatal notices about what the parser had to do or discard -- dropped PGN variations,
   * stripped NAGs. Plan §5 3.3 requires these be reported rather than silently lost; §4.5's
   * `ImportRecord` has no warnings field, so they are surfaced through `message`.
   */
  notes: string[];
}

export type ParsedRecord =
  | { index: number; ok: true; candidate: ImportCandidate }
  | { index: number; ok: false; message: string };

/**
 * `ok: false` means the *file* could not be read at all (unparseable JSON, headerless CSV) and
 * therefore yielded no records. A record that is individually malformed is an `ok: false`
 * `ParsedRecord` inside an `ok: true` result -- plan §6: "one malformed record does not abort
 * the whole batch".
 */
export type ParseResult = { ok: true; records: ParsedRecord[] } | { ok: false; message: string };

/** Plan §5 3.3: import the game as one puzzle, or cut puzzles out of positions the user picked. */
export type PgnImportMode = "WHOLE_GAME" | "EXTRACT_PLIES";

export interface PgnImportOptions {
  mode: PgnImportMode;
  /** Zero-based ply indices into each game's mainline. Only read when mode is EXTRACT_PLIES. */
  plies?: number[];
}
