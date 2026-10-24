import type { PrismaService } from "../prisma/prisma.service";

/**
 * An in-memory stand-in for the Prisma operations the stats, settings and backup services use.
 * There is no Postgres for the Vitest suite to own a schema against (see
 * apps/api/src/imports/fake-prisma.ts for the full rationale).
 *
 * Unlike the per-module fakes alongside it, this one is shared: §5.4's acceptance criterion is
 * that a backup, a wipe and a restore reproduce *identical stats*, which is a single assertion
 * spanning all three services over one set of tables. Splitting it per module would mean three
 * fakes that had to agree on the same rows.
 *
 * Two behaviours are modelled rather than stubbed, because the code under test depends on them:
 * deleting a puzzle cascades (prisma/schema.prisma declares `onDelete: Cascade` for moves, cards
 * and review logs), and `createMany` coerces ISO date strings to `Date`, as Prisma does for a
 * `DateTime` column.
 */

type CardState = "NEW" | "LEARNING" | "REVIEW" | "RELEARNING";

export interface PuzzleRow {
  id: string;
  userId: string;
  fen: string;
  sideToMove: string;
  difficulty: number;
  source: string | null;
  explanation: string | null;
  themes: string[];
  tags: string[];
  dedupeHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MoveRow {
  id: string;
  puzzleId: string;
  parentId: string | null;
  ply: number;
  san: string;
  actor: "SOLVER" | "OPPONENT";
  isPrimary: boolean;
  comment: string | null;
}

export interface CardRow {
  id: string;
  userId: string;
  puzzleId: string;
  state: CardState;
  dueAt: Date;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  learningStep: number;
  lastReviewedAt: Date | null;
}

export interface ReviewLogRow {
  id: string;
  userId: string;
  puzzleId: string;
  cardId: string;
  rating: string;
  correct: boolean;
  hintsUsed: number;
  durationMs: number;
  reviewedAt: Date;
  elapsedDays: number;
  scheduledDays: number;
  intervalBefore: number;
  easeBefore: number;
  repsBefore: number;
  lapsesBefore: number;
  stateBefore: CardState;
}

export interface SettingsRow {
  userId: string;
  timezone: string;
  dayRolloverHour: number;
  newPerDay: number;
  reviewsPerDay: number | null;
}

interface DateFilter {
  gte?: Date;
  lte?: Date;
}

const DATE_FIELDS = new Set(["dueAt", "lastReviewedAt", "reviewedAt", "createdAt", "updatedAt"]);

export class FakePrisma {
  puzzles: PuzzleRow[] = [];
  moves: MoveRow[] = [];
  cards: CardRow[] = [];
  reviewLogs: ReviewLogRow[] = [];
  settings: SettingsRow[] = [];

  asPrisma(): PrismaService {
    return this as unknown as PrismaService;
  }

  readonly puzzle = {
    findMany: ({ where }: { where: { userId: string }; orderBy?: unknown }): Promise<PuzzleRow[]> =>
      Promise.resolve(byId(this.puzzles.filter((row) => row.userId === where.userId))),

    createMany: ({ data }: { data: Record<string, unknown>[] }): Promise<{ count: number }> => {
      this.puzzles.push(...data.map((row) => coerceDates(row) as unknown as PuzzleRow));
      return Promise.resolve({ count: data.length });
    },

    deleteMany: ({ where }: { where: { userId: string } }): Promise<{ count: number }> => {
      const doomed = new Set(
        this.puzzles.filter((row) => row.userId === where.userId).map((row) => row.id),
      );
      this.puzzles = this.puzzles.filter((row) => !doomed.has(row.id));
      this.moves = this.moves.filter((row) => !doomed.has(row.puzzleId));
      this.cards = this.cards.filter((row) => !doomed.has(row.puzzleId));
      this.reviewLogs = this.reviewLogs.filter((row) => !doomed.has(row.puzzleId));
      return Promise.resolve({ count: doomed.size });
    },
  };

  readonly puzzleMove = {
    findMany: ({ where }: { where: { puzzle: { userId: string } }; orderBy?: unknown }): Promise<MoveRow[]> => {
      const owned = new Set(
        this.puzzles.filter((row) => row.userId === where.puzzle.userId).map((row) => row.id),
      );
      return Promise.resolve(
        this.moves.filter((row) => owned.has(row.puzzleId)).sort((a, b) => a.ply - b.ply || a.id.localeCompare(b.id)),
      );
    },

    createMany: ({ data }: { data: Record<string, unknown>[] }): Promise<{ count: number }> => {
      this.moves.push(...data.map((row) => coerceDates(row) as unknown as MoveRow));
      return Promise.resolve({ count: data.length });
    },
  };

  readonly puzzleCard = {
    findMany: ({ where }: { where: { userId: string }; orderBy?: unknown }): Promise<CardRow[]> =>
      Promise.resolve(byId(this.cards.filter((row) => row.userId === where.userId))),

    createMany: ({ data }: { data: Record<string, unknown>[] }): Promise<{ count: number }> => {
      this.cards.push(...data.map((row) => coerceDates(row) as unknown as CardRow));
      return Promise.resolve({ count: data.length });
    },

    count: ({
      where,
    }: {
      where: { userId: string; state?: { in: readonly CardState[] }; dueAt?: DateFilter };
    }): Promise<number> =>
      Promise.resolve(
        this.cards.filter(
          (row) =>
            row.userId === where.userId &&
            (where.state === undefined || where.state.in.includes(row.state)) &&
            matchesDate(row.dueAt, where.dueAt),
        ).length,
      ),
  };

  readonly reviewLog = {
    /** Serves both callers: stats joins the puzzle for its themes/difficulty, the queue builder
     * filters on `stateBefore` and reads only `reviewedAt`. Returning every column of both shapes
     * is harmless -- neither caller looks past what it selected. */
    findMany: ({
      where,
    }: {
      where: {
        userId: string;
        reviewedAt?: DateFilter;
        stateBefore?: CardState | { not: CardState };
      };
      select?: unknown;
    }): Promise<(ReviewLogRow & { puzzle: { themes: string[]; difficulty: number } })[]> =>
      Promise.resolve(
        this.reviewLogs
          .filter(
            (row) =>
              row.userId === where.userId &&
              matchesDate(row.reviewedAt, where.reviewedAt) &&
              matchesState(row.stateBefore, where.stateBefore),
          )
          .map((row) => {
            const puzzle = this.puzzles.find((candidate) => candidate.id === row.puzzleId);
            return {
              ...row,
              puzzle: { themes: puzzle?.themes ?? [], difficulty: puzzle?.difficulty ?? 0 },
            };
          }),
      ),

    createMany: ({ data }: { data: Record<string, unknown>[] }): Promise<{ count: number }> => {
      this.reviewLogs.push(...data.map((row) => coerceDates(row) as unknown as ReviewLogRow));
      return Promise.resolve({ count: data.length });
    },
  };

  readonly userSettings = {
    findUnique: ({ where }: { where: { userId: string } }): Promise<SettingsRow | null> =>
      Promise.resolve(this.settings.find((row) => row.userId === where.userId) ?? null),

    upsert: ({
      where,
      create,
      update,
    }: {
      where: { userId: string };
      create: SettingsRow;
      update: Omit<SettingsRow, "userId">;
    }): Promise<SettingsRow> => {
      const existing = this.settings.find((row) => row.userId === where.userId);
      if (!existing) {
        this.settings.push({ ...create });
        return Promise.resolve({ ...create });
      }
      Object.assign(existing, update);
      return Promise.resolve(existing);
    },
  };

  /** Restore's wipe-then-insert is the only transaction here, and the suite exercises it only on
   * paths that reach the end, so no rollback is modelled (as in the training fake). */
  async $transaction<T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function byId<T extends { id: string }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => a.id.localeCompare(b.id));
}

function matchesDate(value: Date, filter: DateFilter | undefined): boolean {
  if (!filter) {
    return true;
  }
  if (filter.gte && value.getTime() < filter.gte.getTime()) {
    return false;
  }
  return !(filter.lte && value.getTime() > filter.lte.getTime());
}

function matchesState(value: CardState, filter: CardState | { not: CardState } | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  return typeof filter === "string" ? value === filter : value !== filter.not;
}

function coerceDates(row: Record<string, unknown>): Record<string, unknown> {
  const coerced: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(coerced)) {
    if (DATE_FIELDS.has(key) && typeof value === "string") {
      coerced[key] = new Date(value);
    }
  }
  return coerced;
}
