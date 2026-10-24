import type { Puzzle, PuzzleCard } from "@prisma/client";
import { civilDateFor } from "@chess-tactics/domain";
import type { PrismaService } from "../prisma/prisma.service";
import type { EffectiveSettings } from "./settings";

export type QueuedCard = PuzzleCard & { puzzle: Puzzle };

const DUE_STATES = ["LEARNING", "REVIEW", "RELEARNING"] as const;

/** Wide enough to contain every instant that could fall on "today" under any timezone/rollover
 * combination, without needing to compute an exact UTC day boundary (plan day.ts's own doc comment
 * explains why that arithmetic is avoided). Counts are then exact-filtered by civilDateFor below. */
const DAILY_COUNT_OVERFETCH_MS = 48 * 60 * 60 * 1000;

/**
 * Plan §4.3: overdue/due reviews served first and uncapped by default (`reviewsPerDay = null`
 * means unlimited); new cards served afterwards, capped at `newPerDay` per civil day (plan §3.8).
 * Both caps are counted from completed `ReviewLog` rows, not from cards merely shown -- a puzzle
 * fetched but abandoned before rating should not consume the day's budget.
 */
export async function pickNextCard(
  prisma: PrismaService,
  userId: string,
  settings: EffectiveSettings,
  now: Date,
): Promise<QueuedCard | null> {
  const dueCards = await dueQueue(prisma, userId, settings, now);
  if (dueCards.length > 0) {
    return dueCards[0] ?? null;
  }

  const newBudget = await remainingNewBudget(prisma, userId, settings, now);
  if (newBudget <= 0) {
    return null;
  }

  const newCards = await prisma.puzzleCard.findMany({
    where: { userId, state: "NEW" },
    orderBy: { puzzle: { createdAt: "asc" } },
    take: newBudget,
    include: { puzzle: true },
  });
  return newCards[0] ?? null;
}

async function dueQueue(
  prisma: PrismaService,
  userId: string,
  settings: EffectiveSettings,
  now: Date,
): Promise<QueuedCard[]> {
  const rows = await prisma.puzzleCard.findMany({
    where: { userId, state: { in: [...DUE_STATES] }, dueAt: { lte: now } },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    include: { puzzle: true },
  });

  if (settings.reviewsPerDay === null) {
    return rows;
  }
  const reviewedToday = await countReviewedToday(prisma, userId, settings, now, "non-new");
  const remaining = Math.max(0, settings.reviewsPerDay - reviewedToday);
  return rows.slice(0, remaining);
}

async function remainingNewBudget(
  prisma: PrismaService,
  userId: string,
  settings: EffectiveSettings,
  now: Date,
): Promise<number> {
  const servedToday = await countReviewedToday(prisma, userId, settings, now, "new");
  return Math.max(0, settings.newPerDay - servedToday);
}

/** Counts completed ReviewLog rows "today" (plan §3.8), split by whether the card was NEW at the
 * time of that review -- that split is what newPerDay vs. reviewsPerDay each cap. */
async function countReviewedToday(
  prisma: PrismaService,
  userId: string,
  settings: EffectiveSettings,
  now: Date,
  which: "new" | "non-new",
): Promise<number> {
  const since = new Date(now.getTime() - DAILY_COUNT_OVERFETCH_MS);
  const rows = await prisma.reviewLog.findMany({
    where: {
      userId,
      reviewedAt: { gte: since },
      stateBefore: which === "new" ? "NEW" : { not: "NEW" },
    },
    select: { reviewedAt: true },
  });

  const today = civilDateFor(now, settings.timezone, settings.dayRolloverHour);
  return rows.filter((row) => civilDateFor(row.reviewedAt, settings.timezone, settings.dayRolloverHour) === today)
    .length;
}
