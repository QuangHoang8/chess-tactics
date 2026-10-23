import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { dedupeKeyOf, type ValidatedTreeNode } from "@chess-tactics/domain";

type Tx = Prisma.TransactionClient;

export interface PuzzleInsert {
  userId: string;
  fen: string;
  sideToMove: string;
  difficulty: number;
  themes: string[];
  tags: string[];
  source?: string | undefined;
  explanation?: string | undefined;
  importBatchId?: string | undefined;
  /** Already through validateSolution, so every `san` is in canonical form (plan §3.2). */
  tree: ValidatedTreeNode[];
}

/**
 * The single path by which a puzzle enters the database. Shared by `POST /puzzles` and the
 * import committer so the two cannot drift -- in particular so an imported puzzle gets its
 * `PuzzleCard` in the same transaction (plan §2.4) and is therefore visible to the Phase 4
 * training queue.
 *
 * Takes `tx` rather than a client: the caller owns the transaction boundary, which for imports
 * is one record (a failure must not roll back the rest of the batch).
 */
export async function insertPuzzle(tx: Tx, insert: PuzzleInsert): Promise<string> {
  const puzzle = await tx.puzzle.create({
    data: {
      userId: insert.userId,
      fen: insert.fen,
      sideToMove: insert.sideToMove,
      difficulty: insert.difficulty,
      themes: insert.themes,
      tags: insert.tags,
      dedupeHash: dedupeHashOf(insert.fen),
      ...(insert.source !== undefined ? { source: insert.source } : {}),
      ...(insert.explanation !== undefined ? { explanation: insert.explanation } : {}),
      ...(insert.importBatchId !== undefined ? { importBatchId: insert.importBatchId } : {}),
    },
  });

  await createMoveTree(tx, puzzle.id, null, insert.tree, 1);
  await tx.puzzleCard.create({ data: { userId: insert.userId, puzzleId: puzzle.id, dueAt: new Date() } });

  return puzzle.id;
}

/** Mirrors prisma/seed.ts's hashing -- both hash dedupeKeyOf's output the same way, so seed data,
 * API-created puzzles and imported puzzles can never silently disagree on what is a duplicate. */
export function dedupeHashOf(fen: string): string {
  return createHash("sha256").update(dedupeKeyOf(fen)).digest("hex");
}

export async function createMoveTree(
  tx: Tx,
  puzzleId: string,
  parentId: string | null,
  nodes: ValidatedTreeNode[],
  ply: number,
): Promise<void> {
  for (const node of nodes) {
    const created = await tx.puzzleMove.create({
      data: {
        puzzleId,
        parentId,
        ply,
        san: node.san,
        actor: node.actor,
        isPrimary: node.isPrimary,
        ...(node.comment !== undefined ? { comment: node.comment } : {}),
      },
    });
    await createMoveTree(tx, puzzleId, created.id, node.children, ply + 1);
  }
}
