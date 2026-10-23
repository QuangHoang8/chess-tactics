import type { PuzzleMove } from "@prisma/client";
import type { SolutionTreeInput } from "@chess-tactics/domain";
import type { PuzzleMoveNode, TreeNodeInput } from "@chess-tactics/contracts";

/** Converts the request's recursive TreeNode shape into domain's SolutionTreeInput -- same fields,
 * different package boundary (plan §4.5's wire shape mirrors the domain validator's input shape
 * by design, so this is a type-level relabel, not a transform). */
export function toSolutionTreeInput(nodes: TreeNodeInput[]): SolutionTreeInput[] {
  return nodes.map((node) => ({
    san: node.san,
    actor: node.actor,
    isPrimary: node.isPrimary,
    ...(node.comment !== undefined ? { comment: node.comment } : {}),
    children: toSolutionTreeInput(node.children),
  }));
}

/** Reassembles the flat `PuzzleMove` rows for one puzzle into the nested response shape
 * (`GET /puzzles/:id` returns "the full moves tree", plan §4.5). */
export function rowsToPuzzleMoveNodes(rows: PuzzleMove[], parentId: string | null = null): PuzzleMoveNode[] {
  return rows
    .filter((row) => row.parentId === parentId)
    .map((row) => ({
      id: row.id,
      san: row.san,
      actor: row.actor,
      isPrimary: row.isPrimary,
      ...(row.comment !== null && row.comment !== undefined ? { comment: row.comment } : {}),
      children: rowsToPuzzleMoveNodes(rows, row.id),
    }));
}

/** Reconstructs the currently-stored tree as SolutionTreeInput, for the PATCH case where `fen`
 * changes but `moves` is omitted -- the whole tree must still be re-validated against the new FEN
 * (plan §4.5). Stored SAN is already chess.js-normalised, so this is a faithful round-trip. */
export function rowsToSolutionTreeInput(rows: PuzzleMove[], parentId: string | null = null): SolutionTreeInput[] {
  return rows
    .filter((row) => row.parentId === parentId)
    .map((row) => ({
      san: row.san,
      actor: row.actor,
      isPrimary: row.isPrimary,
      ...(row.comment !== null && row.comment !== undefined ? { comment: row.comment } : {}),
      children: rowsToSolutionTreeInput(rows, row.id),
    }));
}
