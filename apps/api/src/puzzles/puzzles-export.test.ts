import { beforeEach, describe, expect, it } from "vitest";
import { parseCsv, parseJsonImport } from "@chess-tactics/domain";
import type { ExportPuzzlesQuery } from "@chess-tactics/contracts";
import { FakePrisma } from "../imports/fake-prisma";
import { PuzzlesExportService } from "./puzzles-export.service";

const USER_ID = "user-1";
const BACK_RANK = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";

let prisma: FakePrisma;
let service: PuzzlesExportService;

beforeEach(() => {
  prisma = new FakePrisma();
  service = new PuzzlesExportService(prisma.asPrisma());
});

function query(overrides: Partial<ExportPuzzlesQuery> = {}): ExportPuzzlesQuery {
  return { format: "json", includeCards: false, includeReviews: false, ...overrides };
}

async function read(options: Partial<ExportPuzzlesQuery>): Promise<string> {
  const stream = service.export(USER_ID, query(options)).getStream();
  let text = "";
  for await (const chunk of stream) {
    text += String(chunk);
  }
  return text;
}

async function seed(
  count: number,
  overrides: { userId?: string } = {},
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    // FENs are opaque to export, so a distinct string per row is enough to tell them apart.
    const puzzle = await prisma.puzzle.create({
      data: {
        userId: overrides.userId ?? USER_ID,
        fen: `${BACK_RANK} #${String(i).padStart(4, "0")}`,
        sideToMove: "w",
        difficulty: 2,
        themes: ["backRankMate"],
        tags: [],
        source: "Book",
        explanation: 'He said "mate", then left',
        dedupeHash: `hash-${i}`,
        importBatchId: null,
      },
    });
    await prisma.puzzleMove.create({
      data: {
        puzzleId: puzzle.id,
        parentId: null,
        ply: 1,
        san: "Ra8#",
        actor: "SOLVER",
        isPrimary: true,
        comment: null,
      },
    });
    await prisma.puzzleCard.create({
      data: { userId: USER_ID, puzzleId: puzzle.id, dueAt: new Date("2026-01-01T00:00:00.000Z") },
    });
  }
}

describe("JSON export", () => {
  it("emits the envelope the JSON importer reads back", async () => {
    await seed(2);
    const result = parseJsonImport(await read({ format: "json" }));

    if (!result.ok) throw new Error(result.message);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({ ok: true });
    if (!result.records[0]?.ok) return;
    expect(result.records[0].candidate).toMatchObject({
      difficulty: 2,
      themes: ["backRankMate"],
      source: "Book",
    });
  });

  it("emits a valid empty document when there is nothing to export", async () => {
    expect(JSON.parse(await read({ format: "json" }))).toMatchObject({ puzzles: [] });
  });

  it("pages through more puzzles than fit in one query", async () => {
    await seed(250);
    const result = parseJsonImport(await read({ format: "json" }));

    if (!result.ok) throw new Error(result.message);
    expect(result.records).toHaveLength(250);
  });

  it("adds card state only when asked", async () => {
    await seed(1);
    const without = JSON.parse(await read({ format: "json" })) as { puzzles: unknown[] };
    const with_ = JSON.parse(await read({ format: "json", includeCards: true })) as {
      puzzles: { card?: { state: string } }[];
    };

    expect(without.puzzles[0]).not.toHaveProperty("card");
    expect(with_.puzzles[0]?.card).toMatchObject({ state: "NEW" });
  });

  it("stays importable with cards and reviews attached", async () => {
    await seed(1);
    const result = parseJsonImport(
      await read({ format: "json", includeCards: true, includeReviews: true }),
    );
    expect(result.ok).toBe(true);
  });

  it("exports nothing belonging to another user", async () => {
    await seed(1, { userId: "someone-else" });
    expect(JSON.parse(await read({ format: "json" }))).toMatchObject({ puzzles: [] });
  });
});

describe("CSV export", () => {
  it("writes the documented header and one quoted row per puzzle", async () => {
    await seed(1);
    const rows = parseCsv(await read({ format: "csv" }));

    expect(rows[0]).toEqual(["fen", "difficulty", "themes", "tags", "source", "explanation", "solution"]);
    expect(rows[1]).toEqual([
      `${BACK_RANK} #0000`,
      "2",
      "backRankMate",
      "",
      "Book",
      'He said "mate", then left',
      "Ra8#",
    ]);
  });

  it("appends card columns when asked", async () => {
    await seed(1);
    const rows = parseCsv(await read({ format: "csv", includeCards: true }));

    expect(rows[0]?.slice(7)).toEqual([
      "state",
      "dueAt",
      "intervalDays",
      "easeFactor",
      "repetitions",
      "lapses",
    ]);
    expect(rows[1]?.[7]).toBe("NEW");
  });

  it("writes only a header when there is nothing to export", async () => {
    expect(parseCsv(await read({ format: "csv" }))).toHaveLength(1);
  });
});
