import { Prisma } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * An in-memory stand-in for the handful of Prisma operations the import and export paths use.
 *
 * There is no Postgres on this machine (docker-compose.yml notwithstanding) and the dev database
 * is a shared remote one, so the integration suite cannot own a schema. What it must model
 * faithfully to be worth anything is the `@@unique([userId, dedupeHash])` constraint -- that
 * constraint *is* the deduplication mechanism of plan §3.5 -- and transaction rollback, so a
 * failed record leaves nothing behind. Both are implemented here; anything else the suite does
 * not exercise is absent rather than faked.
 */

interface PuzzleRow {
  id: string;
  userId: string;
  fen: string;
  sideToMove: string;
  difficulty: number;
  themes: string[];
  tags: string[];
  source: string | null;
  explanation: string | null;
  dedupeHash: string;
  importBatchId: string | null;
}

interface MoveRow {
  id: string;
  puzzleId: string;
  parentId: string | null;
  ply: number;
  san: string;
  actor: string;
  isPrimary: boolean;
  comment: string | null;
}

interface CardRow {
  id: string;
  userId: string;
  puzzleId: string;
  dueAt: Date;
  /** Schema defaults; `insertPuzzle` relies on the database supplying them. */
  state: string;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
}

const CARD_DEFAULTS = {
  state: "NEW",
  intervalDays: 0,
  easeFactor: 2.5,
  repetitions: 0,
  lapses: 0,
} as const;

interface BatchRow {
  id: string;
  userId: string;
  kind: string;
  status: string;
  idempotencyKey: string;
  sourceName: string | null;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  report: unknown;
  createdAt: Date;
}

/** Mirrors Prisma's create input: the id and any column with a default or null are optional. */
type CreateData<Row, Defaulted extends keyof Row> = Omit<Row, "id" | Defaulted> &
  Partial<Pick<Row, Defaulted>>;

interface Tables {
  puzzles: PuzzleRow[];
  moves: MoveRow[];
  cards: CardRow[];
  batches: BatchRow[];
}

export class FakePrisma {
  private tables: Tables = { puzzles: [], moves: [], cards: [], batches: [] };
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

  /** The service takes a PrismaService; only this narrow surface is ever called. */
  asPrisma(): PrismaService {
    return this as unknown as PrismaService;
  }

  readonly puzzle = {
    findMany: ({
      where,
      include,
      take,
      cursor,
      skip,
    }: {
      where: { userId: string; dedupeHash?: { in: string[] } };
      include?: { moves?: boolean; card?: boolean; reviewLogs?: boolean };
      take?: number;
      cursor?: { id: string };
      skip?: number;
      [key: string]: unknown;
    }): Promise<unknown[]> => {
      let rows = this.tables.puzzles
        .filter(
          (row) =>
            row.userId === where.userId &&
            (where.dedupeHash === undefined || where.dedupeHash.in.includes(row.dedupeHash)),
        )
        // Export pages with `orderBy: {id: "asc"}`; the suite only ever asks for that order.
        .sort((a, b) => a.id.localeCompare(b.id));

      if (cursor) {
        const at = rows.findIndex((row) => row.id === cursor.id);
        rows = at === -1 ? [] : rows.slice(at + (skip ?? 0));
      }
      if (take !== undefined) {
        rows = rows.slice(0, take);
      }

      return Promise.resolve(
        rows.map((row) => ({
          ...row,
          ...(include?.moves ? { moves: this.tables.moves.filter((m) => m.puzzleId === row.id) } : {}),
          ...(include?.card
            ? { card: this.tables.cards.find((c) => c.puzzleId === row.id) ?? null }
            : {}),
          ...(include?.reviewLogs ? { reviewLogs: [] } : {}),
        })),
      );
    },

    create: ({
      data,
    }: {
      data: CreateData<PuzzleRow, "source" | "explanation" | "importBatchId">;
    }): Promise<PuzzleRow> => {
      const clash = this.tables.puzzles.some(
        (row) => row.userId === data.userId && row.dedupeHash === data.dedupeHash,
      );
      if (clash) {
        return Promise.reject(uniqueViolation(["userId", "dedupeHash"]));
      }
      const row: PuzzleRow = {
        id: this.id("puzzle"),
        source: null,
        explanation: null,
        importBatchId: null,
        ...data,
      };
      this.tables.puzzles.push(row);
      return Promise.resolve(row);
    },
  };

  readonly puzzleMove = {
    create: ({ data }: { data: CreateData<MoveRow, "parentId" | "comment"> }): Promise<MoveRow> => {
      const row: MoveRow = { id: this.id("move"), parentId: null, comment: null, ...data };
      this.tables.moves.push(row);
      return Promise.resolve(row);
    },
  };

  readonly puzzleCard = {
    create: ({
      data,
    }: {
      data: CreateData<CardRow, keyof typeof CARD_DEFAULTS>;
    }): Promise<CardRow> => {
      const row: CardRow = { id: this.id("card"), ...CARD_DEFAULTS, ...data };
      this.tables.cards.push(row);
      return Promise.resolve(row);
    },
  };

  readonly importBatch = {
    findUnique: ({
      where,
    }: {
      where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } };
    }): Promise<BatchRow | null> =>
      Promise.resolve(
        this.tables.batches.find(
          (row) =>
            row.userId === where.userId_idempotencyKey.userId &&
            row.idempotencyKey === where.userId_idempotencyKey.idempotencyKey,
        ) ?? null,
      ),

    findFirst: ({ where }: { where: { id: string; userId: string } }): Promise<BatchRow | null> =>
      Promise.resolve(
        this.tables.batches.find((row) => row.id === where.id && row.userId === where.userId) ?? null,
      ),

    create: ({
      data,
    }: {
      data: CreateData<BatchRow, "sourceName" | "createdAt">;
    }): Promise<BatchRow> => {
      const clash = this.tables.batches.some(
        (row) => row.userId === data.userId && row.idempotencyKey === data.idempotencyKey,
      );
      if (clash) {
        return Promise.reject(uniqueViolation(["userId", "idempotencyKey"]));
      }
      const row: BatchRow = { id: this.id("batch"), createdAt: new Date(), sourceName: null, ...data };
      this.tables.batches.push(row);
      return Promise.resolve(row);
    },

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<BatchRow>;
    }): Promise<BatchRow> => {
      const row = this.tables.batches.find((batch) => batch.id === where.id);
      if (!row) {
        return Promise.reject(new Error(`No import batch ${where.id}`));
      }
      Object.assign(row, data);
      return Promise.resolve(row);
    },
  };

  /** Restores every table if the callback throws, so a failed record leaves no partial write. */
  async $transaction<T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> {
    const snapshot: Tables = {
      puzzles: [...this.tables.puzzles],
      moves: [...this.tables.moves],
      cards: [...this.tables.cards],
      batches: [...this.tables.batches],
    };
    try {
      return await fn(this);
    } catch (error) {
      this.tables = snapshot;
      throw error;
    }
  }

  private id(prefix: string): string {
    this.nextId += 1;
    return `${prefix}-${this.nextId}`;
  }
}

function uniqueViolation(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}
