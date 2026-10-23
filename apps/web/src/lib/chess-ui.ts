import { fenStringToPositionObject, type PositionDataType } from "react-chessboard";
import { applySan, type Actor, type SolutionTreeInput } from "@chess-tactics/domain";
import type { PuzzleMoveNode } from "@chess-tactics/contracts";

export const SPARE_PIECE_TYPES = [
  "bK", "bQ", "bR", "bB", "bN", "bP",
  "wK", "wQ", "wR", "wB", "wN", "wP",
] as const;

const FILES = "abcdefgh";

/** Default starting point in the position editor: an empty board, white to move. Tactics
 * puzzles are custom positions, not the standard game array. */
export const EMPTY_BOARD_FEN = "8/8/8/8/8/8/8/8 w - - 0 1";

/** The inverse of react-chessboard's `fenStringToPositionObject` -- it has no board->FEN helper,
 * so this is hand-rolled (board field only; side-to-move/castling/en-passant/clocks are appended
 * separately, see `buildFen`). */
export function positionToBoardFen(position: PositionDataType): string {
  const ranks: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = "";
    let empty = 0;
    for (const file of FILES) {
      const piece = position[`${file}${rank}`];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      const letter = piece.pieceType.slice(1, 2);
      row += piece.pieceType.startsWith("w") ? letter.toUpperCase() : letter.toLowerCase();
    }
    if (empty > 0) {
      row += String(empty);
    }
    ranks.push(row);
  }
  return ranks.join("/");
}

/** Castling/en-passant are deliberately out of scope for the board editor (plan §2.3 call) --
 * always "-"/"-", with clocks pinned at "0 1". FEN-paste remains the escape hatch for a puzzle
 * that genuinely needs castling rights or an en-passant target. */
export function buildFen(position: PositionDataType, sideToMove: "w" | "b"): string {
  return `${positionToBoardFen(position)} ${sideToMove} - - 0 1`;
}

export function parseFenToPosition(fen: string): { position: PositionDataType; sideToMove: "w" | "b" } {
  const boardField = fen.trim().split(/\s+/)[0] ?? "";
  const sideField = fen.trim().split(/\s+/)[1];
  return {
    position: fenStringToPositionObject(boardField, 8, 8),
    sideToMove: sideField === "b" ? "b" : "w",
  };
}

export interface EditorNode {
  id: string;
  parentId: string | null;
  san: string;
  actor: Actor;
  isPrimary: boolean;
  comment: string;
  /** Position immediately after this move -- cached so navigating the tree doesn't replay moves. */
  fen: string;
}

export function childrenOf(nodes: EditorNode[], parentId: string | null): EditorNode[] {
  return nodes.filter((n) => n.parentId === parentId);
}

/** The server derives actor purely from ply (root = SOLVER, alternating) and never validates
 * alternation -- training.service.ts assumes it. The editor must therefore never let a user pick
 * actor directly; it's always computed from the parent's actor. */
export function nextActorAfter(parent: EditorNode | undefined): Actor {
  if (!parent) {
    return "SOLVER";
  }
  return parent.actor === "SOLVER" ? "OPPONENT" : "SOLVER";
}

/** Nested tree, for live client-side validateSolution() and for the submit payload -- typed as
 * domain's SolutionTreeInput (omittable `comment`, not `comment?: string | undefined`) so it
 * satisfies validateSolution directly; it's structurally assignable to contracts' wider
 * TreeNodeInput for the API payload too (see packages/contracts/src/schemas/puzzle.ts's note on
 * why that interface allows the `| undefined` zod infers). */
export function assembleTree(nodes: EditorNode[], parentId: string | null = null): SolutionTreeInput[] {
  return childrenOf(nodes, parentId).map((node) => ({
    san: node.san,
    actor: node.actor,
    isPrimary: node.isPrimary,
    ...(node.comment.trim() !== "" ? { comment: node.comment.trim() } : {}),
    children: assembleTree(nodes, node.id),
  }));
}

/** Replays a persisted move tree (as returned by GET /puzzles/:id) against the root FEN to
 * reconstruct the editor's flat, FEN-cached node list -- used when opening an existing puzzle. */
export function hydrateNodes(tree: PuzzleMoveNode[], rootFen: string): EditorNode[] {
  const out: EditorNode[] = [];
  walk(tree, null, rootFen);
  return out;

  function walk(siblings: PuzzleMoveNode[], parentId: string | null, parentFen: string): void {
    for (const node of siblings) {
      const applied = applySan(parentFen, node.san);
      if (!applied.ok) {
        // A persisted tree is assumed sound (it passed validateSolution on save); if this ever
        // fires the stored data and this reconstruction disagree, which is a bug to surface loudly
        // rather than silently drop the subtree.
        throw new Error(`hydrateNodes: stored move "${node.san}" does not apply to ${parentFen}: ${applied.error}`);
      }
      out.push({
        id: node.id,
        parentId,
        san: node.san,
        actor: node.actor,
        isPrimary: node.isPrimary,
        comment: node.comment ?? "",
        fen: applied.fen,
      });
      walk(node.children, node.id, applied.fen);
    }
  }
}
