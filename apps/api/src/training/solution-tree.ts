import type { PuzzleMove } from "@prisma/client";
import { applySan } from "@chess-tactics/domain";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * Replays the primary-or-chosen path from the puzzle's root FEN to `nodeId`, by SAN. Used to
 * recover `currentFen` on resume (plan §4.6) instead of persisting it, since it's fully derivable
 * from `currentNodeId` plus the puzzle's stored move tree.
 */
export async function resolveFen(
  prisma: PrismaService,
  puzzleId: string,
  puzzleFen: string,
  nodeId: string | null,
): Promise<string> {
  if (nodeId === null) {
    return puzzleFen;
  }

  const moves = await prisma.puzzleMove.findMany({ where: { puzzleId } });
  const byId = new Map(moves.map((move) => [move.id, move]));

  const chain: PuzzleMove[] = [];
  let cursor: string | null = nodeId;
  while (cursor !== null) {
    const node = byId.get(cursor);
    if (!node) {
      throw new Error(`resolveFen: PuzzleMove ${cursor} not found for puzzle ${puzzleId}`);
    }
    chain.push(node);
    cursor = node.parentId;
  }
  chain.reverse();

  let fen = puzzleFen;
  for (const node of chain) {
    const applied = applySan(fen, node.san);
    if (!applied.ok) {
      throw new Error(
        `resolveFen: stored move "${node.san}" (PuzzleMove ${node.id}) failed to apply from ${fen}: ${applied.error}`,
      );
    }
    fen = applied.fen;
  }
  return fen;
}

/** The full primary line (both actors, root to terminal) as SAN strings -- plan §4.5's
 * `POST /training/skip` response shape, matching the §7 seed table's "Ra7 Kg8 Rb8#" format. */
export async function primaryLine(prisma: PrismaService, puzzleId: string): Promise<string[]> {
  const moves = await prisma.puzzleMove.findMany({ where: { puzzleId } });
  const byParent = new Map<string | null, PuzzleMove[]>();
  for (const move of moves) {
    const siblings = byParent.get(move.parentId) ?? [];
    siblings.push(move);
    byParent.set(move.parentId, siblings);
  }

  const line: string[] = [];
  let parent: string | null = null;
  for (;;) {
    const siblings: PuzzleMove[] = byParent.get(parent) ?? [];
    const next: PuzzleMove | undefined = siblings.find((candidate) => candidate.isPrimary) ?? siblings[0];
    if (!next) {
      break;
    }
    line.push(next.san);
    parent = next.id;
  }
  return line;
}

/** The accepted SOLVER continuations directly under `parentId` (null = puzzle root). */
export function solverCandidates(
  prisma: PrismaService,
  puzzleId: string,
  parentId: string | null,
): Promise<PuzzleMove[]> {
  return prisma.puzzleMove.findMany({ where: { puzzleId, parentId, actor: "SOLVER" } });
}

/** Picks the puzzle's designated main line among sibling nodes, falling back to the first one. */
export function primaryOf(nodes: PuzzleMove[]): PuzzleMove | undefined {
  return nodes.find((node) => node.isPrimary) ?? nodes[0];
}
