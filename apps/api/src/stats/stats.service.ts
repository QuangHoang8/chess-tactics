import { BadRequestException, Injectable } from "@nestjs/common";
import { civilDateRange, civilDaysBetween } from "@chess-tactics/domain";
import {
  DEFAULT_STATS_WINDOW_DAYS,
  MAX_STATS_WINDOW_DAYS,
  type StatsQuery,
  type StatsResponse,
} from "@chess-tactics/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { getEffectiveSettings } from "../settings/effective-settings";
import { DUE_STATES, remainingNewBudget } from "../training/queue";
import { resolveWindow, summarise, type AggregableReview, type StatsWindow } from "./aggregate";

/** The window's edges are civil dates in the user's zone; this pads the UTC fetch wide enough to
 * contain them under any zone/rollover combination, and `summarise` then filters exactly. Same
 * trick, same reason as `queue.ts`'s DAILY_COUNT_OVERFETCH_MS. */
const WINDOW_OVERFETCH_MS = 48 * 60 * 60 * 1000;

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Plan §4.5 `GET /stats`. §5.1's headline numbers plus §5.2's breakdown, over one window. */
  async get(userId: string, query: StatsQuery): Promise<StatsResponse> {
    const now = new Date();
    const settings = await getEffectiveSettings(this.prisma, userId);

    const window = resolveWindow(now, settings, query, DEFAULT_STATS_WINDOW_DAYS);
    const span = civilDaysBetween(window.from, window.to);
    if (span > MAX_STATS_WINDOW_DAYS) {
      throw new BadRequestException(`Range must span at most ${MAX_STATS_WINDOW_DAYS} days`);
    }

    const [reviews, dueNow, remainingNewToday] = await Promise.all([
      this.reviewsNear(userId, window),
      this.prisma.puzzleCard.count({
        where: { userId, state: { in: [...DUE_STATES] }, dueAt: { lte: now } },
      }),
      remainingNewBudget(this.prisma, userId, settings, now),
    ]);

    const breakdown = summarise(reviews, civilDateRange(window.from, window.to), settings, query.groupBy);
    return { ...breakdown, dueNow, remainingNewToday };
  }

  private async reviewsNear(userId: string, window: StatsWindow): Promise<AggregableReview[]> {
    const rows = await this.prisma.reviewLog.findMany({
      where: {
        userId,
        reviewedAt: {
          gte: new Date(Date.parse(`${window.from}T00:00:00Z`) - WINDOW_OVERFETCH_MS),
          lte: new Date(Date.parse(`${window.to}T23:59:59.999Z`) + WINDOW_OVERFETCH_MS),
        },
      },
      select: {
        reviewedAt: true,
        correct: true,
        puzzle: { select: { themes: true, difficulty: true } },
      },
    });

    return rows.map((row) => ({
      reviewedAt: row.reviewedAt,
      correct: row.correct,
      themes: row.puzzle.themes,
      difficulty: row.puzzle.difficulty,
    }));
  }
}
