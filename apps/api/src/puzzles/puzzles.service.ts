import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma, type CardState, type Puzzle } from "@prisma/client";
import { validateSolution } from "@chess-tactics/domain";
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
import { createMoveTree, dedupeHashOf, insertPuzzle } from "./puzzle-persistence";
import { rowsToPuzzleMoveNodes, rowsToSolutionTreeInput, toSolutionTreeInput } from "./puzzle-tree";

@Injectable()
export class PuzzlesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, request: CreatePuzzleRequest): Promise<CreatePuzzleResponse> {
    const result = validateSolution(request.fen, toSolutionTreeInput(request.moves));
    if (!result.ok) {
      throw unprocessable(result.errors);
    }

    try {
      const id = await this.prisma.$transaction((tx) =>
        insertPuzzle(tx, {
          userId,
          fen: request.fen,
          sideToMove: result.sideToMove,
          difficulty: request.difficulty,
          themes: request.themes,
          tags: request.tags,
          source: request.source,
          explanation: request.explanation,
          tree: result.tree,
        }),
      );

      return { id, coverageWarnings: result.warnings };
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
