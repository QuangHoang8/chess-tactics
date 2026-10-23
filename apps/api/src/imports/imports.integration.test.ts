import "reflect-metadata";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Module,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FileInterceptor } from "@nestjs/platform-express";
import type { INestApplication } from "@nestjs/common";
import {
  commitImportRequestSchema,
  createImportRequestSchema,
  type CommitImportResponse,
  type ImportBatchResponse,
} from "@chess-tactics/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpExceptionFilter } from "../common/http-exception.filter";
import { FakePrisma } from "./fake-prisma";
import { ImportsService, type UploadedImportFile } from "./imports.service";

/**
 * Drives the real ImportsService over real HTTP, so multipart decoding, the Idempotency-Key
 * header and the error envelope are all exercised rather than assumed.
 *
 * The controller is declared here rather than imported because Vitest transpiles with esbuild,
 * which does not implement TypeScript's `emitDecoratorMetadata` -- so `design:paramtypes` is
 * absent and Nest's constructor injection and the global ZodValidationPipe's metatype lookup both
 * come up empty. `nest build` (plain tsc) emits that metadata, so production is unaffected. The
 * two workarounds below restore exactly what production gets: an explicit `@Inject` token, and
 * an explicit schema parse where the global pipe would run.
 */
@Controller("imports")
class TestImportsController {
  constructor(@Inject(ImportsService) private readonly importsService: ImportsService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file"))
  create(
    @UploadedFile() file: UploadedImportFile | undefined,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<ImportBatchResponse> {
    if (!file) {
      throw new BadRequestException("A file is required");
    }
    if (!idempotencyKey) {
      throw new BadRequestException("An Idempotency-Key header is required");
    }
    const parsed = createImportRequestSchema.parse(body);
    return this.importsService.preview(USER_ID, { ...parsed, file, idempotencyKey });
  }

  @Post(":id/commit")
  commit(@Param("id") id: string, @Body() body: unknown): Promise<CommitImportResponse> {
    return this.importsService.commit(USER_ID, id, commitImportRequestSchema.parse(body ?? {}));
  }

  @Get(":id")
  findOne(@Param("id") id: string): Promise<ImportBatchResponse> {
    return this.importsService.findOne(USER_ID, { id });
  }
}

const USER_ID = "user-1";
const BACK_RANK = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
const OPENING = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const LADDER = "6k1/8/8/8/8/8/R7/1R4K1 w - - 0 1";

const SCHOLARS_MATE = `[Event "A"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;

/** Puzzle-style PGNs: each carries its own [FEN], so the two are distinct positions. */
const BACK_RANK_PGN = `[Event "P1"]
[FEN "${BACK_RANK}"]
[SetUp "1"]

1. Ra8# 1-0`;

const LADDER_PGN = `[Event "P2"]
[FEN "${LADDER}"]
[SetUp "1"]

1. Ra8+ Kh7 2. Rb7# 1-0`;

function jsonPuzzle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fen: BACK_RANK,
    difficulty: 2,
    themes: ["backRankMate"],
    tags: ["mate-in-1"],
    moves: [{ san: "Ra8#", actor: "SOLVER", isPrimary: true, children: [] }],
    ...overrides,
  };
}

let app: INestApplication;
let baseUrl: string;
let prisma: FakePrisma;

beforeEach(async () => {
  prisma = new FakePrisma();
  const service = new ImportsService(prisma.asPrisma());

  @Module({
    controllers: [TestImportsController],
    providers: [{ provide: ImportsService, useValue: service }],
  })
  class TestModule {}

  app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0);
  baseUrl = await app.getUrl();
});

afterEach(async () => {
  await app.close();
});

interface UploadOptions {
  kind: "JSON" | "CSV" | "PGN";
  body: string;
  filename?: string;
  idempotencyKey?: string | null;
  mode?: string;
  plies?: string;
  withFile?: boolean;
}

async function upload(options: UploadOptions): Promise<{ status: number; body: ImportBatchResponse }> {
  const form = new FormData();
  if (options.withFile !== false) {
    form.append("file", new Blob([options.body]), options.filename ?? "import.txt");
  }
  form.append("kind", options.kind);
  if (options.mode) {
    form.append("mode", options.mode);
  }
  if (options.plies) {
    form.append("plies", options.plies);
  }

  const headers: Record<string, string> = {};
  if (options.idempotencyKey !== null) {
    headers["Idempotency-Key"] = options.idempotencyKey ?? "key-1";
  }

  const response = await fetch(`${baseUrl}/api/imports`, { method: "POST", body: form, headers });
  return { status: response.status, body: (await response.json()) as ImportBatchResponse };
}

async function commit(
  batchId: string,
  skipIndices?: number[],
): Promise<{ status: number; body: CommitImportResponse }> {
  const response = await fetch(`${baseUrl}/api/imports/${batchId}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(skipIndices ? { skipIndices } : {}),
  });
  return { status: response.status, body: (await response.json()) as CommitImportResponse };
}

describe("preview", () => {
  it("reports every record and writes no puzzle", async () => {
    const { status, body } = await upload({
      kind: "JSON",
      filename: "puzzles.json",
      body: JSON.stringify([jsonPuzzle()]),
    });

    expect(status).toBe(201);
    expect(body).toMatchObject({
      status: "PREVIEWED",
      kind: "JSON",
      sourceName: "puzzles.json",
      totalRows: 1,
      acceptedRows: 1,
      rejectedRows: 0,
    });
    expect(body.report[0]).toMatchObject({ index: 0, status: "ACCEPTED", fen: BACK_RANK });
    expect(prisma.puzzles).toHaveLength(0);
  });

  it("rejects a record whose solution fails the Phase 2 validator, naming the ply", async () => {
    const illegal = jsonPuzzle({
      moves: [{ san: "Ra9#", actor: "SOLVER", isPrimary: true, children: [] }],
    });
    const { body } = await upload({ kind: "JSON", body: JSON.stringify([illegal]) });

    expect(body.report[0]).toMatchObject({ status: "REJECTED" });
    expect(body.report[0]?.message).toContain("ply 1");
  });

  it("keeps the good records when one in the file is malformed", async () => {
    const { body } = await upload({
      kind: "JSON",
      body: JSON.stringify([
        jsonPuzzle(),
        jsonPuzzle({ difficulty: 99 }),
        jsonPuzzle({ fen: OPENING, moves: [{ san: "e4", actor: "SOLVER", isPrimary: true, children: [] }] }),
      ]),
    });

    expect(body.report.map((record) => record.status)).toEqual(["ACCEPTED", "REJECTED", "ACCEPTED"]);
    expect(body).toMatchObject({ totalRows: 3, acceptedRows: 2, rejectedRows: 1 });
  });

  it("marks a second occurrence of the same position inside one file as a duplicate", async () => {
    const { body } = await upload({ kind: "JSON", body: JSON.stringify([jsonPuzzle(), jsonPuzzle()]) });

    expect(body.report.map((record) => record.status)).toEqual(["ACCEPTED", "DUPLICATE"]);
    expect(body.report[1]?.message).toContain("record 0");
    expect(body.report[1]?.duplicateOfPuzzleId).toBeUndefined();
  });

  it("422s a file it cannot read at all", async () => {
    const { status, body } = await upload({ kind: "JSON", body: "{not json" });
    expect(status).toBe(422);
    expect(body).toMatchObject({ statusCode: 422 });
  });

  it("400s without an Idempotency-Key header", async () => {
    const { status } = await upload({
      kind: "JSON",
      body: JSON.stringify([jsonPuzzle()]),
      idempotencyKey: null,
    });
    expect(status).toBe(400);
  });

  it("400s without a file", async () => {
    const { status } = await upload({ kind: "JSON", body: "", withFile: false });
    expect(status).toBe(400);
  });
});

describe("commit", () => {
  it("creates the puzzle, its move tree and its card", async () => {
    const { body: preview } = await upload({ kind: "JSON", body: JSON.stringify([jsonPuzzle()]) });
    const { status, body } = await commit(preview.batchId);

    expect(status).toBe(201);
    expect(body).toMatchObject({ status: "COMMITTED", created: 1, skipped: 0 });
    expect(prisma.puzzles).toHaveLength(1);
    expect(prisma.puzzles[0]).toMatchObject({ fen: BACK_RANK, importBatchId: preview.batchId });
    // Plan §2.4: the card is created with the puzzle, or the training queue never sees it.
    expect(prisma.cards).toHaveLength(1);
    expect(prisma.moves.map((move) => move.san)).toEqual(["Ra8#"]);
  });

  it("creates only the valid records of a mixed batch", async () => {
    const { body: preview } = await upload({
      kind: "JSON",
      body: JSON.stringify([jsonPuzzle(), jsonPuzzle({ difficulty: 99 })]),
    });
    const { body } = await commit(preview.batchId);

    expect(body).toMatchObject({ created: 1, skipped: 1 });
    expect(prisma.puzzles).toHaveLength(1);
  });

  it("honours skipIndices", async () => {
    const second = jsonPuzzle({
      fen: OPENING,
      moves: [{ san: "e4", actor: "SOLVER", isPrimary: true, children: [] }],
    });
    const { body: preview } = await upload({
      kind: "JSON",
      body: JSON.stringify([jsonPuzzle(), second]),
    });
    const { body } = await commit(preview.batchId, [0]);

    expect(body).toMatchObject({ created: 1, skipped: 1 });
    expect(prisma.puzzles[0]?.fen).toBe(OPENING);
  });

  it("returns the original counts when replayed, creating nothing twice", async () => {
    const { body: preview } = await upload({ kind: "JSON", body: JSON.stringify([jsonPuzzle()]) });
    const first = await commit(preview.batchId);
    const second = await commit(preview.batchId);

    expect(second.body).toEqual(first.body);
    expect(prisma.puzzles).toHaveLength(1);
  });

  it("reports a position that appeared between preview and commit as a duplicate", async () => {
    const { body: preview } = await upload({ kind: "JSON", body: JSON.stringify([jsonPuzzle()]) });

    const { body: other } = await upload({
      kind: "JSON",
      body: JSON.stringify([jsonPuzzle()]),
      idempotencyKey: "key-2",
    });
    await commit(other.batchId);
    expect(prisma.puzzles).toHaveLength(1);

    const { body } = await commit(preview.batchId);
    expect(body).toMatchObject({ created: 0, skipped: 1 });
    expect(prisma.puzzles).toHaveLength(1);

    const reread = await fetch(`${baseUrl}/api/imports/${preview.batchId}`);
    const batch = (await reread.json()) as ImportBatchResponse;
    expect(batch.report[0]?.status).toBe("DUPLICATE");
  });

  it("leaves nothing behind when a record fails mid-write", async () => {
    const { body: preview } = await upload({ kind: "JSON", body: JSON.stringify([jsonPuzzle()]) });
    const { body: other } = await upload({
      kind: "JSON",
      body: JSON.stringify([jsonPuzzle()]),
      idempotencyKey: "key-2",
    });
    await commit(other.batchId);

    const movesBefore = prisma.moves.length;
    const cardsBefore = prisma.cards.length;
    await commit(preview.batchId);

    expect(prisma.moves).toHaveLength(movesBefore);
    expect(prisma.cards).toHaveLength(cardsBefore);
  });
});

describe("idempotency", () => {
  it("returns the original report for a replayed Idempotency-Key without re-processing", async () => {
    const first = await upload({ kind: "JSON", body: JSON.stringify([jsonPuzzle()]) });

    // A different file under the same key must not be read -- the key identifies the batch.
    const second = await upload({
      kind: "JSON",
      body: JSON.stringify([jsonPuzzle({ fen: LADDER, moves: [{ san: "Ra8#", actor: "SOLVER", isPrimary: true, children: [] }] })]),
    });

    expect(second.body).toEqual(first.body);
  });

  it("replays a committed batch rather than committing it again", async () => {
    const { body: preview } = await upload({ kind: "JSON", body: JSON.stringify([jsonPuzzle()]) });
    await commit(preview.batchId);

    const replay = await upload({ kind: "JSON", body: JSON.stringify([jsonPuzzle()]) });
    expect(replay.body.status).toBe("COMMITTED");
    expect(prisma.puzzles).toHaveLength(1);
  });

  it("imports the same file twice under different keys and creates nothing the second time", async () => {
    const file = JSON.stringify([jsonPuzzle()]);

    const first = await upload({ kind: "JSON", body: file, idempotencyKey: "key-1" });
    await commit(first.body.batchId);

    const second = await upload({ kind: "JSON", body: file, idempotencyKey: "key-2" });
    expect(second.body.report[0]).toMatchObject({
      status: "DUPLICATE",
      duplicateOfPuzzleId: prisma.puzzles[0]?.id,
    });

    const { body } = await commit(second.body.batchId);
    expect(body.created).toBe(0);
    expect(prisma.puzzles).toHaveLength(1);
  });
});

describe("PGN uploads", () => {
  it("imports a multi-game file as N records", async () => {
    const { body } = await upload({
      kind: "PGN",
      mode: "WHOLE_GAME",
      filename: "games.pgn",
      body: `${BACK_RANK_PGN}\n\n${LADDER_PGN}\n`,
    });

    expect(body).toMatchObject({ kind: "PGN", totalRows: 2, acceptedRows: 2 });

    const { body: committed } = await commit(body.batchId);
    expect(committed.created).toBe(2);
    expect(prisma.puzzles).toHaveLength(2);
  });

  it("dedupes whole games that share a starting position", async () => {
    // Position identity is puzzle identity (plan §4), so two games from the standard opening
    // are one puzzle. This is why WHOLE_GAME is for puzzle PGNs carrying their own [FEN], and
    // EXTRACT_PLIES is for real games.
    const { body } = await upload({
      kind: "PGN",
      mode: "WHOLE_GAME",
      body: `${SCHOLARS_MATE}\n\n[Event "B"]\n\n1. d4 d5 2. c4 e6 *\n`,
    });

    expect(body.report.map((record) => record.status)).toEqual(["ACCEPTED", "DUPLICATE"]);
  });

  it("imports a {comment} $NAG game after normalisation", async () => {
    const { body } = await upload({
      kind: "PGN",
      mode: "WHOLE_GAME",
      body: `[Event "N"]\n\n1. e4 {a good move} $1 e5 2. Nf3 Nc6 *`,
    });

    expect(body.report[0]).toMatchObject({ status: "ACCEPTED" });
    expect(body.report[0]?.message).toContain("NAG");
  });

  it("warns on the record that variations were dropped", async () => {
    const { body } = await upload({
      kind: "PGN",
      mode: "WHOLE_GAME",
      body: `[Event "V"]\n\n1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 *`,
    });

    expect(body.report[0]?.message).toContain("Variations were dropped");
  });

  it("cuts one puzzle per selected ply in EXTRACT_PLIES mode", async () => {
    const { body } = await upload({
      kind: "PGN",
      mode: "EXTRACT_PLIES",
      plies: "4,6",
      body: SCHOLARS_MATE,
    });

    expect(body.totalRows).toBe(2);
    await commit(body.batchId);
    expect(prisma.puzzles).toHaveLength(2);
    expect(prisma.puzzles.every((puzzle) => puzzle.sideToMove === "w")).toBe(true);
  });

  it("400s when EXTRACT_PLIES is asked for with no plies", async () => {
    const { status } = await upload({ kind: "PGN", mode: "EXTRACT_PLIES", body: SCHOLARS_MATE });
    expect(status).toBe(400);
  });
});

describe("CSV uploads", () => {
  it("imports a flat row as a linear solution", async () => {
    const { body } = await upload({
      kind: "CSV",
      filename: "puzzles.csv",
      body: `fen,difficulty,themes,tags,source,explanation,solution\n"${BACK_RANK}",2,backRankMate,mate-in-1,Book,"Rook to a8, mate",Ra8#`,
    });

    expect(body.report[0]).toMatchObject({ status: "ACCEPTED", fen: BACK_RANK });

    await commit(body.batchId);
    expect(prisma.puzzles[0]).toMatchObject({
      difficulty: 2,
      themes: ["backRankMate"],
      source: "Book",
      explanation: "Rook to a8, mate",
    });
  });
});

describe("GET /imports/:id", () => {
  it("returns the batch and its report", async () => {
    const { body: preview } = await upload({ kind: "JSON", body: JSON.stringify([jsonPuzzle()]) });

    const response = await fetch(`${baseUrl}/api/imports/${preview.batchId}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(preview);
  });

  it("404s for an unknown batch", async () => {
    const response = await fetch(`${baseUrl}/api/imports/nope`);
    expect(response.status).toBe(404);
  });
});
