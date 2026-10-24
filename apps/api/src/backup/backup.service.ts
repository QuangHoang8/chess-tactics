import { BadRequestException, Injectable } from "@nestjs/common";
import {
  BACKUP_FORMAT_VERSION,
  type BackupDocument,
  type RestoreResponse,
} from "@chess-tactics/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { referentialErrors } from "./document";

@Injectable()
export class BackupService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Plan §4.5 `GET /backup`. Carries every column of every training row, unlike
   * `GET /puzzles/export`, which is a sharing format and drops the FSRS inputs -- §5.4's criterion
   * is that a restore reproduces identical stats, and `ReviewLog.stateBefore` alone is what the
   * queue builder's new-vs-review split reads.
   */
  async backup(userId: string): Promise<BackupDocument> {
    const [settings, puzzles, moves, cards, reviewLogs] = await Promise.all([
      this.prisma.userSettings.findUnique({ where: { userId } }),
      this.prisma.puzzle.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      this.prisma.puzzleMove.findMany({ where: { puzzle: { userId } }, orderBy: [{ ply: "asc" }, { id: "asc" }] }),
      this.prisma.puzzleCard.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      this.prisma.reviewLog.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    ]);

    return {
      version: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      settings: settings && {
        timezone: settings.timezone,
        dayRolloverHour: settings.dayRolloverHour,
        newPerDay: settings.newPerDay,
        reviewsPerDay: settings.reviewsPerDay,
      },
      puzzles: puzzles.map((puzzle) => ({
        id: puzzle.id,
        fen: puzzle.fen,
        sideToMove: puzzle.sideToMove === "b" ? "b" : "w",
        difficulty: puzzle.difficulty,
        source: puzzle.source,
        explanation: puzzle.explanation,
        themes: puzzle.themes,
        tags: puzzle.tags,
        dedupeHash: puzzle.dedupeHash,
        createdAt: puzzle.createdAt.toISOString(),
        updatedAt: puzzle.updatedAt.toISOString(),
      })),
      moves: moves.map((move) => ({
        id: move.id,
        puzzleId: move.puzzleId,
        parentId: move.parentId,
        ply: move.ply,
        san: move.san,
        actor: move.actor,
        isPrimary: move.isPrimary,
        comment: move.comment,
      })),
      cards: cards.map((card) => ({
        id: card.id,
        puzzleId: card.puzzleId,
        state: card.state,
        dueAt: card.dueAt.toISOString(),
        intervalDays: card.intervalDays,
        easeFactor: card.easeFactor,
        repetitions: card.repetitions,
        lapses: card.lapses,
        learningStep: card.learningStep,
        lastReviewedAt: card.lastReviewedAt?.toISOString() ?? null,
      })),
      reviewLogs: reviewLogs.map((log) => ({
        id: log.id,
        puzzleId: log.puzzleId,
        cardId: log.cardId,
        rating: log.rating,
        correct: log.correct,
        hintsUsed: log.hintsUsed,
        durationMs: log.durationMs,
        reviewedAt: log.reviewedAt.toISOString(),
        elapsedDays: log.elapsedDays,
        scheduledDays: log.scheduledDays,
        intervalBefore: log.intervalBefore,
        easeBefore: log.easeBefore,
        repsBefore: log.repsBefore,
        lapsesBefore: log.lapsesBefore,
        stateBefore: log.stateBefore,
      })),
    };
  }

  /**
   * Plan §4.5 `POST /restore`. Destructive and scoped to the caller: the document *replaces* their
   * puzzles, moves, cards and review logs rather than merging into them. Merging would double
   * every row on a second restore and collide with `Puzzle.@@unique([userId, dedupeHash])`, and
   * §5.4's criterion ("restore reproduces identical stats") only holds for a replacement.
   *
   * Ids travel with the rows so the solution tree's `parentId` links and each log's `cardId`
   * survive the round trip.
   */
  async restore(userId: string, document: BackupDocument): Promise<RestoreResponse> {
    const errors = referentialErrors(document);
    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    await this.prisma.$transaction(async (tx) => {
      // Cascades to PuzzleMove, PuzzleCard and ReviewLog (prisma/schema.prisma).
      await tx.puzzle.deleteMany({ where: { userId } });

      await tx.puzzle.createMany({
        data: document.puzzles.map((puzzle) => ({ ...puzzle, userId })),
      });
      // Parents before children: a self-referencing FK is satisfied within one statement, but
      // ordering by ply keeps that true if this ever has to be split into batches.
      await tx.puzzleMove.createMany({
        data: [...document.moves].sort((a, b) => a.ply - b.ply),
      });
      await tx.puzzleCard.createMany({
        data: document.cards.map((card) => ({ ...card, userId })),
      });
      await tx.reviewLog.createMany({
        data: document.reviewLogs.map((log) => ({ ...log, userId })),
      });

      if (document.settings) {
        await tx.userSettings.upsert({
          where: { userId },
          create: { userId, ...document.settings },
          update: document.settings,
        });
      }
    });

    return {
      restored: {
        puzzles: document.puzzles.length,
        moves: document.moves.length,
        cards: document.cards.length,
        logs: document.reviewLogs.length,
      },
    };
  }
}
