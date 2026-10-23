import { Readable } from "node:stream";
import { Injectable, StreamableFile } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { CSV_COLUMNS, CSV_HEADER_ROW, formatCsvRow, puzzleToCsvRow } from "@chess-tactics/domain";
import type { ExportPuzzlesQuery } from "@chess-tactics/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { rowsToSolutionTreeInput } from "./puzzle-tree";

/** Puzzles are read a page at a time so a large collection never lands in memory at once. */
const PAGE_SIZE = 100;

/** Appended to the docs/formats.md column set when `includeCards` is on. */
const CARD_COLUMNS = ["state", "dueAt", "intervalDays", "easeFactor", "repetitions", "lapses"];

/** `card` and `reviewLogs` are only joined when asked for, so both are optional on the row. */
type ExportRow = Prisma.PuzzleGetPayload<{ include: { moves: true } }> & {
  card?: Prisma.PuzzleCardGetPayload<object> | null;
  reviewLogs?: Prisma.ReviewLogGetPayload<object>[];
};

@Injectable()
export class PuzzlesExportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Plan §4.5: `GET /puzzles/export?format=json|csv` returns a file stream. */
  export(userId: string, query: ExportPuzzlesQuery): StreamableFile {
    const chunks =
      query.format === "csv" ? this.csvChunks(userId, query) : this.jsonChunks(userId, query);

    return new StreamableFile(Readable.from(chunks), {
      type: query.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      disposition: `attachment; filename="puzzles.${query.format}"`,
    });
  }

  private async *jsonChunks(userId: string, query: ExportPuzzlesQuery): AsyncGenerator<string> {
    yield `{"exportedAt":${JSON.stringify(new Date().toISOString())},"puzzles":[`;
    let first = true;
    for await (const puzzle of this.pages(userId, query)) {
      yield (first ? "" : ",") + JSON.stringify(toJsonPuzzle(puzzle, query));
      first = false;
    }
    yield "]}";
  }

  private async *csvChunks(userId: string, query: ExportPuzzlesQuery): AsyncGenerator<string> {
    // `includeReviews` is deliberately ignored here: CSV is one row per puzzle and a puzzle has
    // many reviews. docs/formats.md says so.
    yield `${query.includeCards ? formatCsvRow([...CSV_COLUMNS, ...CARD_COLUMNS]) : CSV_HEADER_ROW}\n`;
    for await (const puzzle of this.pages(userId, query)) {
      const row = puzzleToCsvRow({
        fen: puzzle.fen,
        difficulty: puzzle.difficulty,
        themes: puzzle.themes,
        tags: puzzle.tags,
        source: puzzle.source ?? undefined,
        explanation: puzzle.explanation ?? undefined,
        moves: rowsToSolutionTreeInput(puzzle.moves),
      });
      yield query.includeCards ? `${row},${formatCsvRow(cardCells(puzzle))}\n` : `${row}\n`;
    }
  }

  private async *pages(userId: string, query: ExportPuzzlesQuery): AsyncGenerator<ExportRow> {
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.puzzle.findMany({
        where: { userId },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { moves: true, card: query.includeCards, reviewLogs: query.includeReviews },
      });

      for (const puzzle of page) {
        yield puzzle;
      }

      const last = page[page.length - 1];
      if (!last || page.length < PAGE_SIZE) {
        return;
      }
      cursor = last.id;
    }
  }
}

/**
 * The docs/formats.md §1 shape, so an export file re-imports unedited. `card` and `reviews` are
 * extra keys the JSON importer ignores.
 */
function toJsonPuzzle(puzzle: ExportRow, query: ExportPuzzlesQuery): Record<string, unknown> {
  return {
    fen: puzzle.fen,
    difficulty: puzzle.difficulty,
    themes: puzzle.themes,
    tags: puzzle.tags,
    ...(puzzle.source !== null ? { source: puzzle.source } : {}),
    ...(puzzle.explanation !== null ? { explanation: puzzle.explanation } : {}),
    moves: rowsToSolutionTreeInput(puzzle.moves),
    ...(query.includeCards && puzzle.card
      ? {
          card: {
            state: puzzle.card.state,
            dueAt: puzzle.card.dueAt.toISOString(),
            intervalDays: puzzle.card.intervalDays,
            easeFactor: puzzle.card.easeFactor,
            repetitions: puzzle.card.repetitions,
            lapses: puzzle.card.lapses,
          },
        }
      : {}),
    ...(query.includeReviews
      ? {
          reviews: (puzzle.reviewLogs ?? []).map((log) => ({
            rating: log.rating,
            correct: log.correct,
            hintsUsed: log.hintsUsed,
            durationMs: log.durationMs,
            reviewedAt: log.reviewedAt.toISOString(),
          })),
        }
      : {}),
  };
}

function cardCells(puzzle: ExportRow): string[] {
  const card = puzzle.card;
  return card
    ? [
        card.state,
        card.dueAt.toISOString(),
        String(card.intervalDays),
        String(card.easeFactor),
        String(card.repetitions),
        String(card.lapses),
      ]
    : CARD_COLUMNS.map(() => "");
}
