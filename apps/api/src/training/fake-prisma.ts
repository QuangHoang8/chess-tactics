import type { PrismaService } from "../prisma/prisma.service";

/**
 * An in-memory stand-in for the Prisma operations training.service.ts/queue.ts/settings.ts/
 * solution-tree.ts use. There is no Postgres on this machine for the Vitest suite to own a schema
 * against (see apps/api/src/imports/fake-prisma.ts for the same situation and the full rationale);
 * this is that pattern's training-module counterpart, extended with puzzleCard/reviewLog/
 * trainingSession tables and a userSettings table.
 */

export interface PuzzleRow {
  id: string;
  userId: string;
  fen: string;
  sideToMove: string;
  themes: string[];
  explanation: string | null;
  createdAt: Date;
}

export interface MoveRow {
  id: string;
  puzzleId: string;
  parentId: string | null;
  san: string;
  actor: "SOLVER" | "OPPONENT";
  isPrimary: boolean;
}

export interface CardRow {
  id: string;
  userId: string;
  puzzleId: string;
  state: "NEW" | "LEARNING" | "REVIEW" | "RELEARNING";
  dueAt: Date;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  learningStep: number;
  lastReviewedAt: Date | null;
}

export interface SessionRow {
  id: string;
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  currentPuzzleId: string | null;
  currentNodeId: string | null;
  solved: boolean;
  skipped: boolean;
  hadRejectedAttempt: boolean;
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
  stateBefore: string;
}

export interface SettingsRow {
  userId: string;
  timezone: string;
  dayRolloverHour: number;
  newPerDay: number;
  reviewsPerDay: number | null;
}

interface Tables {
  puzzles: PuzzleRow[];
  moves: MoveRow[];
  cards: CardRow[];
  sessions: SessionRow[];
  reviewLogs: ReviewLogRow[];
  settings: SettingsRow[];
}

type CreateData<Row, Defaulted extends keyof Row> = Omit<Row, "id" | Defaulted> & Partial<Pick<Row, Defaulted>>;

export class FakeTrainingPrisma {
  private tables: Tables = { puzzles: [], moves: [], cards: [], sessions: [], reviewLogs: [], settings: [] };
  private nextId = 1;

  get puzzles(): readonly PuzzleRow[] {
    return this.tables.puzzles;
  }
  get moves(): readonly MoveRow[] {
    return this.tables.moves;
  }
  get cards(): readonly CardRow[] {
    return this.tables.cards;
  }
  get sessions(): readonly SessionRow[] {
    return this.tables.sessions;
  }
  get reviewLogs(): readonly ReviewLogRow[] {
    return this.tables.reviewLogs;
  }

  asPrisma(): PrismaService {
    return this as unknown as PrismaService;
  }

  seedPuzzle(row: CreateData<PuzzleRow, "themes" | "explanation" | "createdAt">): PuzzleRow {
    const full: PuzzleRow = {
      id: this.id("puzzle"),
      themes: [],
      explanation: null,
      createdAt: new Date(),
      ...row,
    };
    this.tables.puzzles.push(full);
    return full;
  }

  seedMove(row: CreateData<MoveRow, "parentId" | "isPrimary">): MoveRow {
    const full: MoveRow = { id: this.id("move"), parentId: null, isPrimary: true, ...row };
    this.tables.moves.push(full);
    return full;
  }

  seedCard(row: CreateData<CardRow, "intervalDays" | "easeFactor" | "repetitions" | "lapses" | "learningStep" | "lastReviewedAt">): CardRow {
    const full: CardRow = {
      id: this.id("card"),
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
      lapses: 0,
      learningStep: 0,
      lastReviewedAt: null,
      ...row,
    };
    this.tables.cards.push(full);
    return full;
  }

  seedSettings(row: SettingsRow): SettingsRow {
    this.tables.settings.push(row);
    return row;
  }

  seedReviewLog(row: Omit<ReviewLogRow, "id">): ReviewLogRow {
    const full: ReviewLogRow = { id: this.id("review"), ...row };
    this.tables.reviewLogs.push(full);
    return full;
  }

  readonly puzzle = {
    findUniqueOrThrow: ({ where }: { where: { id: string } }): Promise<PuzzleRow> => {
      const row = this.tables.puzzles.find((p) => p.id === where.id);
      if (!row) {
        return Promise.reject(new Error(`No puzzle ${where.id}`));
      }
      return Promise.resolve(row);
    },
  };

  readonly puzzleMove = {
    findMany: ({
      where,
    }: {
      where: { puzzleId?: string; parentId?: string | null; actor?: "SOLVER" | "OPPONENT" };
    }): Promise<MoveRow[]> =>
      Promise.resolve(
        this.tables.moves.filter(
          (m) =>
            (where.puzzleId === undefined || m.puzzleId === where.puzzleId) &&
            (!("parentId" in where) || m.parentId === where.parentId) &&
            (where.actor === undefined || m.actor === where.actor),
        ),
      ),
  };

  readonly puzzleCard = {
    findFirst: ({
      where,
      include,
    }: {
      where: { userId: string; puzzleId: string };
      include?: { puzzle?: boolean };
    }): Promise<(CardRow & { puzzle?: PuzzleRow }) | null> => {
      const row = this.tables.cards.find((c) => c.userId === where.userId && c.puzzleId === where.puzzleId);
      if (!row) {
        return Promise.resolve(null);
      }
      return Promise.resolve(include?.puzzle ? { ...row, puzzle: this.puzzleOf(row.puzzleId) } : row);
    },

    findMany: ({
      where,
      take,
      include,
    }: {
      where: {
        userId: string;
        state?: CardRow["state"] | { in: CardRow["state"][] };
        dueAt?: { lte: Date };
      };
      orderBy?: unknown;
      take?: number;
      include?: { puzzle?: boolean };
    }): Promise<(CardRow & { puzzle?: PuzzleRow })[]> => {
      let rows = this.tables.cards.filter((c) => {
        if (c.userId !== where.userId) return false;
        if (where.state !== undefined) {
          const matches =
            typeof where.state === "string" ? c.state === where.state : where.state.in.includes(c.state);
          if (!matches) return false;
        }
        if (where.dueAt !== undefined && c.dueAt.getTime() > where.dueAt.lte.getTime()) return false;
        return true;
      });

      rows = rows.slice().sort((a, b) => {
        if (where.state !== undefined && typeof where.state !== "string") {
          // dueQueue: order by dueAt asc, id asc.
          return a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id);
        }
        // new-card queue: order by puzzle.createdAt asc.
        return this.puzzleOf(a.puzzleId).createdAt.getTime() - this.puzzleOf(b.puzzleId).createdAt.getTime();
      });

      if (take !== undefined) {
        rows = rows.slice(0, take);
      }
      return Promise.resolve(rows.map((row) => (include?.puzzle ? { ...row, puzzle: this.puzzleOf(row.puzzleId) } : row)));
    },

    update: ({ where, data }: { where: { id: string }; data: Partial<CardRow> }): Promise<CardRow> => {
      const row = this.tables.cards.find((c) => c.id === where.id);
      if (!row) {
        return Promise.reject(new Error(`No card ${where.id}`));
      }
      Object.assign(row, data);
      return Promise.resolve(row);
    },
  };

  readonly trainingSession = {
    create: ({ data }: { data: CreateData<SessionRow, "startedAt" | "endedAt" | "currentNodeId" | "solved" | "skipped" | "hadRejectedAttempt"> }): Promise<SessionRow> => {
      const row: SessionRow = {
        id: this.id("session"),
        startedAt: new Date(),
        endedAt: null,
        currentNodeId: null,
        solved: false,
        skipped: false,
        hadRejectedAttempt: false,
        ...data,
      };
      this.tables.sessions.push(row);
      return Promise.resolve(row);
    },

    findUnique: ({ where }: { where: { id: string } }): Promise<SessionRow | null> =>
      Promise.resolve(this.tables.sessions.find((s) => s.id === where.id) ?? null),

    findFirst: ({
      where,
      orderBy,
    }: {
      where: { userId: string; endedAt: null };
      orderBy?: { startedAt: "desc" | "asc" };
    }): Promise<SessionRow | null> => {
      const rows = this.tables.sessions
        .filter((s) => s.userId === where.userId && s.endedAt === where.endedAt)
        .sort((a, b) =>
          orderBy?.startedAt === "asc"
            ? a.startedAt.getTime() - b.startedAt.getTime()
            : b.startedAt.getTime() - a.startedAt.getTime(),
        );
      return Promise.resolve(rows[0] ?? null);
    },

    update: ({ where, data }: { where: { id: string }; data: Partial<SessionRow> }): Promise<SessionRow> => {
      const row = this.tables.sessions.find((s) => s.id === where.id);
      if (!row) {
        return Promise.reject(new Error(`No session ${where.id}`));
      }
      Object.assign(row, data);
      return Promise.resolve(row);
    },
  };

  readonly reviewLog = {
    create: ({ data }: { data: CreateData<ReviewLogRow, never> }): Promise<ReviewLogRow> => {
      const row: ReviewLogRow = { id: this.id("review"), ...data };
      this.tables.reviewLogs.push(row);
      return Promise.resolve(row);
    },

    findMany: ({
      where,
    }: {
      where: {
        userId: string;
        reviewedAt: { gte: Date };
        stateBefore: string | { not: string };
      };
    }): Promise<{ reviewedAt: Date }[]> =>
      Promise.resolve(
        this.tables.reviewLogs
          .filter(
            (r) =>
              r.userId === where.userId &&
              r.reviewedAt.getTime() >= where.reviewedAt.gte.getTime() &&
              (typeof where.stateBefore === "string"
                ? r.stateBefore === where.stateBefore
                : r.stateBefore !== where.stateBefore.not),
          )
          .map((r) => ({ reviewedAt: r.reviewedAt })),
      ),
  };

  readonly userSettings = {
    findUnique: ({ where }: { where: { userId: string } }): Promise<SettingsRow | null> =>
      Promise.resolve(this.tables.settings.find((s) => s.userId === where.userId) ?? null),
  };

  /** No real rollback semantics (unlike imports' FakePrisma) -- training.service.ts's one
   * $transaction call never throws mid-way in the paths the suite exercises. */
  async $transaction<T>(fn: (tx: FakeTrainingPrisma) => Promise<T>): Promise<T> {
    return fn(this);
  }

  private puzzleOf(puzzleId: string): PuzzleRow {
    const puzzle = this.tables.puzzles.find((p) => p.id === puzzleId);
    if (!puzzle) {
      throw new Error(`No puzzle ${puzzleId}`);
    }
    return puzzle;
  }

  private id(prefix: string): string {
    this.nextId += 1;
    return `${prefix}-${this.nextId}`;
  }
}
