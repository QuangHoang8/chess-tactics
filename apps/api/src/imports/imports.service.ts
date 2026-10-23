import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma, type ImportBatch } from "@prisma/client";
import {
  parseCsvImport,
  parseJsonImport,
  parsePgn,
  validateSolution,
  type ParseResult,
  type ParsedRecord,
  type ValidationWarning,
} from "@chess-tactics/domain";
import type {
  CommitImportRequest,
  CommitImportResponse,
  CreateImportRequest,
  ImportBatchResponse,
  ImportRecord,
} from "@chess-tactics/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { dedupeHashOf, insertPuzzle } from "../puzzles/puzzle-persistence";
import { toSolutionTreeInput } from "../puzzles/puzzle-tree";
import { storedReportSchema, type AcceptedPayload, type StoredReport } from "./import-report";

/** What `FileInterceptor`'s default memory storage yields, verified against the installed
 * @nestjs/platform-express. Declared here rather than as `Express.Multer.File` because
 * @types/multer is not a dependency of this workspace. */
export interface UploadedImportFile {
  originalname: string;
  buffer: Buffer;
}

export interface CreateImportParams extends CreateImportRequest {
  file: UploadedImportFile;
  idempotencyKey: string;
}

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Plan §5 3.4: parse, validate and classify every record, then persist the batch in PREVIEWED
   * status. No `Puzzle` row is written here -- the user sees the report first.
   */
  async preview(userId: string, params: CreateImportParams): Promise<ImportBatchResponse> {
    // Plan §3.5: replaying a key returns the original report rather than re-processing the file.
    const replay = await this.prisma.importBatch.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: params.idempotencyKey } },
    });
    if (replay) {
      return toResponse(replay, readReport(replay).records);
    }

    if (params.kind === "PGN" && params.mode === "EXTRACT_PLIES" && (params.plies ?? []).length === 0) {
      throw new BadRequestException("EXTRACT_PLIES requires at least one ply");
    }

    const parsed = parseFile(params);
    if (!parsed.ok) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: "Unprocessable Entity",
        message: parsed.message,
      });
    }

    const classified = await this.classify(userId, parsed.records);
    const stored: StoredReport = {
      records: classified.map((entry) => entry.record),
      accepted: Object.fromEntries(
        classified.flatMap((entry) =>
          entry.payload ? [[String(entry.record.index), entry.payload] as const] : [],
        ),
      ),
    };
    const acceptedRows = stored.records.filter((record) => record.status === "ACCEPTED").length;

    try {
      const batch = await this.prisma.importBatch.create({
        data: {
          userId,
          kind: params.kind,
          status: "PREVIEWED",
          idempotencyKey: params.idempotencyKey,
          sourceName: params.file.originalname,
          totalRows: stored.records.length,
          acceptedRows,
          // Everything not accepted will not become a puzzle, so the two counts sum to totalRows.
          rejectedRows: stored.records.length - acceptedRows,
          report: toJsonColumn(stored),
        },
      });
      return toResponse(batch, stored.records);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Two concurrent uploads of the same key: the loser returns the winner's report.
        return this.findOne(userId, { idempotencyKey: params.idempotencyKey });
      }
      throw error;
    }
  }

  /**
   * Plan §5 3.4: creates the rows the preview promised. Each record gets its own transaction --
   * a batch-wide one would let a single late conflict roll back every good record, which is
   * exactly what §6's "one malformed record does not abort the whole batch" forbids.
   */
  async commit(
    userId: string,
    batchId: string,
    request: CommitImportRequest,
  ): Promise<CommitImportResponse> {
    const batch = await this.requireOwned(userId, batchId);
    const stored = readReport(batch);

    if (batch.status === "COMMITTED") {
      const previous = stored.commit;
      if (!previous) {
        throw new InternalServerErrorException("Committed batch is missing its commit result");
      }
      return { batchId: batch.id, status: "COMMITTED", ...previous };
    }
    if (batch.status !== "PREVIEWED") {
      throw new ConflictException(`Import batch is ${batch.status}, not PREVIEWED`);
    }

    const skip = new Set(request.skipIndices ?? []);
    const records = [...stored.records];
    let created = 0;

    for (const [position, record] of records.entries()) {
      const payload = stored.accepted[String(record.index)];
      if (record.status !== "ACCEPTED" || !payload || skip.has(record.index)) {
        continue;
      }

      try {
        await this.prisma.$transaction((tx) =>
          insertPuzzle(tx, {
            userId,
            fen: payload.fen,
            sideToMove: payload.sideToMove,
            difficulty: payload.difficulty,
            themes: payload.themes,
            tags: payload.tags,
            source: payload.source,
            explanation: payload.explanation,
            importBatchId: batch.id,
            tree: toSolutionTreeInput(payload.tree),
          }),
        );
        created += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        // The position was created between preview and commit -- report it the same way the
        // preview would have, rather than failing the batch.
        records[position] = {
          ...record,
          status: "DUPLICATE",
          message: "This position already existed by the time the batch was committed",
        };
      }
    }

    const skipped = records.length - created;
    const committed: StoredReport = { ...stored, records, commit: { created, skipped } };
    // `acceptedRows`/`rejectedRows` keep describing what the *file* held and are left alone; what
    // the *commit* did lives in `report.commit`. Overwriting them would make the same two columns
    // mean different things either side of a commit, and make a replayed batch disagree with the
    // report the user approved.
    const updated = await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: "COMMITTED", report: toJsonColumn(committed) },
    });

    return { batchId: updated.id, status: "COMMITTED", created, skipped };
  }

  async findOne(
    userId: string,
    by: { id: string } | { idempotencyKey: string },
  ): Promise<ImportBatchResponse> {
    const batch =
      "id" in by
        ? await this.requireOwned(userId, by.id)
        : await this.prisma.importBatch.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey: by.idempotencyKey } },
          });
    if (!batch) {
      throw new NotFoundException("Import batch not found");
    }
    return toResponse(batch, readReport(batch).records);
  }

  /**
   * Runs every parsed record through the Phase 2 validator -- the same `validateSolution` that
   * `POST /puzzles` uses, so an import cannot smuggle in a puzzle the API would reject.
   */
  private async classify(
    userId: string,
    parsed: ParsedRecord[],
  ): Promise<{ record: ImportRecord; payload?: AcceptedPayload }[]> {
    const existing = await this.existingPuzzlesByHash(userId, parsed);
    const seenInBatch = new Map<string, number>();

    return parsed.map((record) => {
      if (!record.ok) {
        return { record: { index: record.index, status: "REJECTED", message: record.message } };
      }

      const { candidate } = record;
      const result = validateSolution(candidate.fen, candidate.moves);
      if (!result.ok) {
        const [first] = result.errors;
        return {
          record: {
            index: record.index,
            status: "REJECTED",
            fen: candidate.fen,
            message: first ? `ply ${first.ply}: ${first.message} (${first.input})` : "Invalid solution",
          },
        };
      }

      const hash = dedupeHashOf(candidate.fen);
      const duplicateOfPuzzleId = existing.get(hash);
      if (duplicateOfPuzzleId !== undefined) {
        return {
          record: {
            index: record.index,
            status: "DUPLICATE",
            fen: candidate.fen,
            message: "This position is already in your collection",
            duplicateOfPuzzleId,
          },
        };
      }

      const earlier = seenInBatch.get(hash);
      if (earlier !== undefined) {
        return {
          record: {
            index: record.index,
            status: "DUPLICATE",
            fen: candidate.fen,
            message: `Same position as record ${earlier} in this file`,
          },
        };
      }
      seenInBatch.set(hash, record.index);

      const notes = [...candidate.notes, ...result.warnings.map(describeWarning)];
      return {
        record: {
          index: record.index,
          status: "ACCEPTED",
          fen: candidate.fen,
          ...(notes.length > 0 ? { message: notes.join("; ") } : {}),
        },
        payload: {
          fen: candidate.fen,
          sideToMove: result.sideToMove,
          difficulty: candidate.difficulty,
          themes: candidate.themes,
          tags: candidate.tags,
          ...(candidate.source !== undefined ? { source: candidate.source } : {}),
          ...(candidate.explanation !== undefined ? { explanation: candidate.explanation } : {}),
          tree: result.tree,
        },
      };
    });
  }

  /** One query for the whole batch rather than one per record. */
  private async existingPuzzlesByHash(
    userId: string,
    parsed: ParsedRecord[],
  ): Promise<Map<string, string>> {
    const hashes = parsed
      .filter((record) => record.ok)
      .map((record) => dedupeHashOf(record.candidate.fen));
    if (hashes.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.puzzle.findMany({
      where: { userId, dedupeHash: { in: [...new Set(hashes)] } },
      select: { id: true, dedupeHash: true },
    });
    return new Map(rows.map((row) => [row.dedupeHash, row.id]));
  }

  /** A batch owned by another user is invisible -- 404, not 403, matching PuzzlesService. */
  private async requireOwned(userId: string, id: string): Promise<ImportBatch> {
    const batch = await this.prisma.importBatch.findFirst({ where: { id, userId } });
    if (!batch) {
      throw new NotFoundException("Import batch not found");
    }
    return batch;
  }
}

function parseFile(params: CreateImportParams): ParseResult {
  const text = params.file.buffer.toString("utf8");
  switch (params.kind) {
    case "JSON":
      return parseJsonImport(text);
    case "CSV":
      return parseCsvImport(text);
    case "PGN":
      return parsePgn(text, {
        mode: params.mode ?? "WHOLE_GAME",
        ...(params.plies !== undefined ? { plies: params.plies } : {}),
      });
  }
}

function describeWarning(warning: ValidationWarning): string {
  return warning.type === "ends_in_draw"
    ? warning.reason
    : `ply ${warning.ply}: uncovered opponent ${warning.missingReplies.length === 1 ? "reply" : "replies"} ${warning.missingReplies.join(", ")}`;
}

function toResponse(batch: ImportBatch, records: ImportRecord[]): ImportBatchResponse {
  return {
    batchId: batch.id,
    kind: batch.kind,
    status: batch.status,
    ...(batch.sourceName !== null ? { sourceName: batch.sourceName } : {}),
    totalRows: batch.totalRows,
    acceptedRows: batch.acceptedRows,
    rejectedRows: batch.rejectedRows,
    report: records,
    createdAt: batch.createdAt.toISOString(),
  };
}

/**
 * A `StoredReport` has optional properties, which Prisma's `InputJsonValue` refuses -- `undefined`
 * is not a JSON value. Round-tripping drops those keys for real rather than casting past the
 * check, so nothing undefined can reach the column.
 */
function toJsonColumn(report: StoredReport): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(report)) as Prisma.InputJsonValue;
}

function readReport(batch: ImportBatch): StoredReport {
  const parsed = storedReportSchema.safeParse(batch.report);
  if (!parsed.success) {
    throw new InternalServerErrorException("Stored import report is unreadable");
  }
  return parsed.data;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
