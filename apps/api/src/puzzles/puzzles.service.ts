import { createHash } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma, type CardState, type Puzzle } from "@prisma/client";
import { dedupeKeyOf, validateSolution, type ValidatedTreeNode } from "@chess-tactics/domain";
import type {
  CreatePuzzleRequest,
  CreatePuzzleResponse,
  ListPuzzlesQuery,
  ListPuzzlesResponse,
  PuzzleDetail,
  PuzzleSummary,
  UpdatePuzzleRequest,
  UpdatePuzzleResponse,
} from "@chess-tactics/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { rowsToPuzzleMoveNodes, rowsToSolutionTreeInput, toSolutionTreeInput } from "./puzzle-tree";

type Tx = Prisma.TransactionClient;

@Injectable()
export class PuzzlesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, request: CreatePuzzleRequest): Promise<CreatePuzzleResponse> {
    const result = validateSolution(request.fen, toSolutionTreeInput(request.moves));
    if (!result.ok) {
      throw unprocessable(result.errors);
    }

    const dedupeHash = dedupeHashOf(request.fen);

    try {
      const puzzle = await this.prisma.$transaction(async (tx) => {
        const created = await tx.puzzle.create({
          data: {
            userId,
            fen: request.fen,
            sideToMove: result.sideToMove,
            difficulty: request.difficulty,
            themes: request.themes,
            tags: request.tags,
            dedupeHash,
            ...(request.source !== undefined ? { source: request.source } : {}),
            ...(request.explanation !== undefined ? { explanation: request.explanation } : {}),
          },
        });

        await createMoveTree(tx, created.id, null, result.tree, 1);

        // Plan §2.4 / §8: the card is created in the same transaction, in state NEW -- the
        // training queue (Phase 4) serves NEW cards, and a puzzle with no card would be invisible
        // to it two phases later.
        await tx.puzzleCard.create({ data: { userId, puzzleId: created.id, dueAt: new Date() } });

        return created;
      });

      return { id: puzzle.id, coverageWarnings: result.warnings };
    } catch (error) {
      rethrowAsConflict(error);
    }
  }

  async findMany(userId: string, query: ListPuzzlesQuery): Promise<ListPuzzlesResponse> {
    const where: Prisma.PuzzleWhereInput = { userId };
    if (query.themes && query.themes.length > 0) {
      where.themes = { hasSome: query.themes };
    }
    if (query.tags && query.tags.length > 0) {
      where.tags = { hasSome: query.tags };
    }
    if (query.difficulty !== undefined) {
      where.difficulty = query.difficulty;
    }
    if (query.source !== undefined) {
      where.source = query.source;
    }
    if (query.q !== undefined) {
      where.explanation = { contains: query.q, mode: "insensitive" };
    }

    // Both non-cursor fields (createdAt, difficulty, card.dueAt) are non-unique, so `id` is added
    // as a tiebreaker in every case -- otherwise a cursor continuation can skip or repeat rows.
    const orderBy: Prisma.PuzzleOrderByWithRelationInput[] =
      query.sort === "difficulty"
        ? [{ difficulty: "desc" }, { id: "desc" }]
        : query.sort === "due"
          ? [{ card: { dueAt: "asc" } }, { id: "asc" }]
          : [{ createdAt: "desc" }, { id: "desc" }];

    const rows = await this.prisma.puzzle.findMany({
      where,
      orderBy,
      take: query.limit + 1,
      ...(query.cursor !== undefined ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { card: true },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map(toSummary),
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  async findOne(userId: string, id: string): Promise<PuzzleDetail> {
    const puzzle = await this.requireOwned(userId, id);
    const moveRows = await this.prisma.puzzleMove.findMany({ where: { puzzleId: id } });
    return { ...toSummary(puzzle), moves: rowsToPuzzleMoveNodes(moveRows) };
  }

  async update(userId: string, id: string, request: UpdatePuzzleRequest): Promise<UpdatePuzzleResponse> {
    const existing = await this.requireOwned(userId, id);

    // Plan §4.5: re-validate the whole tree whenever `fen` or `moves` is present; a field-only
    // PATCH (e.g. difficulty) touches neither validation nor the stored tree.
    if (request.fen === undefined && request.moves === undefined) {
      const updated = await this.prisma.puzzle.update({
        where: { id },
        data: patchData(request),
      });
      return { id: updated.id, coverageWarnings: [] };
    }

    const fen = request.fen ?? existing.fen;
    const treeInput =
      request.moves !== undefined
        ? toSolutionTreeInput(request.moves)
        : rowsToSolutionTreeInput(await this.prisma.puzzleMove.findMany({ where: { puzzleId: id } }));

    const result = validateSolution(fen, treeInput);
    if (!result.ok) {
      throw unprocessable(result.errors);
    }

    const dedupeHash = dedupeHashOf(fen);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (request.moves !== undefined) {
          await tx.puzzleMove.deleteMany({ where: { puzzleId: id } });
          await createMoveTree(tx, id, null, result.tree, 1);
        }

        return tx.puzzle.update({
          where: { id },
          data: {
            ...patchData(request),
            fen,
            sideToMove: result.sideToMove,
            dedupeHash,
          },
        });
      });

      return { id: updated.id, coverageWarnings: result.warnings };
    } catch (error) {
      rethrowAsConflict(error);
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
    // PuzzleMove and PuzzleCard both cascade on Puzzle delete (schema.prisma onDelete: Cascade).
    await this.prisma.puzzle.delete({ where: { id } });
  }

  /** Plan §6: a puzzle owned by another user is invisible -- 404, not 403, on a miss. */
  private async requireOwned(userId: string, id: string): Promise<Puzzle> {
    const puzzle = await this.prisma.puzzle.findFirst({ where: { id, userId } });
    if (!puzzle) {
      throw new NotFoundException("Puzzle not found");
    }
    return puzzle;
  }
}

function patchData(request: UpdatePuzzleRequest): Prisma.PuzzleUpdateInput {
  return {
    ...(request.difficulty !== undefined ? { difficulty: request.difficulty } : {}),
    ...(request.themes !== undefined ? { themes: request.themes } : {}),
    ...(request.tags !== undefined ? { tags: request.tags } : {}),
    ...(request.source !== undefined ? { source: request.source } : {}),
    ...(request.explanation !== undefined ? { explanation: request.explanation } : {}),
  };
}

function toSummary(
  puzzle: Puzzle & { card?: { state: CardState; dueAt: Date } | null },
): PuzzleSummary {
  return {
    id: puzzle.id,
    fen: puzzle.fen,
    sideToMove: puzzle.sideToMove === "b" ? "b" : "w",
    difficulty: puzzle.difficulty,
    ...(puzzle.source !== null ? { source: puzzle.source } : {}),
    ...(puzzle.explanation !== null ? { explanation: puzzle.explanation } : {}),
    themes: puzzle.themes,
    tags: puzzle.tags,
    createdAt: puzzle.createdAt.toISOString(),
    updatedAt: puzzle.updatedAt.toISOString(),
    ...(puzzle.card
      ? { card: { state: puzzle.card.state, dueAt: puzzle.card.dueAt.toISOString() } }
      : {}),
  };
}

/** Mirrors prisma/seed.ts's hashing -- both hash dedupeKeyOf's output the same way, so seed data
 * and API-created puzzles can never silently disagree on what counts as a duplicate. */
function dedupeHashOf(fen: string): string {
  return createHash("sha256").update(dedupeKeyOf(fen)).digest("hex");
}

/** Takes `tx` explicitly rather than closing over a module-level client (unlike the standalone
 * seed script) -- otherwise the tree writes would land outside the transaction and the "card
 * created atomically with its puzzle" guarantee (plan §2.4) would be false. */
async function createMoveTree(
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

function unprocessable(errors: { ply: number; input: string; message: string }[]): UnprocessableEntityException {
  // Must throw the fully-shaped envelope ourselves: HttpExceptionFilter only passes a thrown body
  // through unchanged when it already carries `statusCode` -- otherwise it reshapes and drops
  // `details`, which is exactly the per-ply failure info Phase 2's acceptance criteria check for.
  return new UnprocessableEntityException({
    statusCode: 422,
    error: "Unprocessable Entity",
    message: "Solution validation failed",
    details: errors.map((e) => ({ path: `moves[${e.ply}]`, ply: e.ply, input: e.input, message: e.message })),
  });
}

function rethrowAsConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ConflictException("A puzzle with this position already exists");
  }
  throw error;
}
