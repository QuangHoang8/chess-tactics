import type { SolutionTreeInput } from "../chess/types";
import { CSV_COLUMNS, formatCsvRow } from "./csv";

/**
 * The subset of a stored puzzle the export formats read. Structural rather than imported from
 * `@chess-tactics/contracts` so packages/domain stays dependency-free in both directions.
 */
export interface ExportablePuzzle {
  fen: string;
  difficulty: number;
  themes: string[];
  tags: string[];
  source?: string | undefined;
  explanation?: string | undefined;
  moves: SolutionTreeInput[];
}

export const CSV_HEADER_ROW = formatCsvRow(CSV_COLUMNS);

/**
 * CSV is flat, so a branched puzzle exports as its primary line only -- the alternatives and
 * uncovered opponent replies the §3.3 tree holds have nowhere to go. Round-tripping a branched
 * puzzle therefore needs `format=json`; docs/formats.md says so.
 */
export function puzzleToCsvRow(puzzle: ExportablePuzzle): string {
  return formatCsvRow([
    puzzle.fen,
    String(puzzle.difficulty),
    puzzle.themes.join(" "),
    puzzle.tags.join(" "),
    puzzle.source ?? "",
    puzzle.explanation ?? "",
    primaryLineOf(puzzle.moves).join(" "),
  ]);
}

/** Follows the `isPrimary` child at each ply, falling back to the first sibling. */
export function primaryLineOf(moves: SolutionTreeInput[]): string[] {
  const line: string[] = [];
  let level = moves;
  while (level.length > 0) {
    const node = level.find((candidate) => candidate.isPrimary) ?? level[0];
    if (!node) {
      break;
    }
    line.push(node.san);
    level = node.children;
  }
  return line;
}
