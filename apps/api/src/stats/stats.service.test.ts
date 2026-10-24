import { beforeEach, describe, expect, it } from "vitest";
import { civilDateFor } from "@chess-tactics/domain";
import { MAX_STATS_WINDOW_DAYS, type StatsQuery } from "@chess-tactics/contracts";
import { FakePrisma, type CardRow, type ReviewLogRow } from "../test-support/fake-prisma";
import { StatsService } from "./stats.service";

const USER = "user-1";
const QUERY: StatsQuery = { groupBy: "theme" };

/** The service reads `new Date()` itself, so the fixtures are anchored to the real clock. */
const NOW = new Date();
const HOUR_AGO = new Date(NOW.getTime() - 3_600_000);

function seedPuzzle(fake: FakePrisma, id: string, themes: string[], difficulty: number): void {
  fake.puzzles.push({
    id,
    userId: USER,
    fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
    sideToMove: "w",
    difficulty,
    source: null,
    explanation: null,
    themes,
    tags: [],
    dedupeHash: `hash-${id}`,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function seedCard(fake: FakePrisma, overrides: Partial<CardRow> & Pick<CardRow, "id" | "puzzleId">): void {
  fake.cards.push({
    userId: USER,
    state: "NEW",
    dueAt: NOW,
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
    learningStep: 0,
    lastReviewedAt: null,
    ...overrides,
  });
}

function seedReview(
  fake: FakePrisma,
  overrides: Partial<ReviewLogRow> & Pick<ReviewLogRow, "id" | "puzzleId" | "cardId">,
): void {
  fake.reviewLogs.push({
    userId: USER,
    rating: "GOOD",
    correct: true,
    hintsUsed: 0,
    durationMs: 1000,
    reviewedAt: HOUR_AGO,
    elapsedDays: 0,
    scheduledDays: 1,
    intervalBefore: 0,
    easeBefore: 2.5,
    repsBefore: 0,
    lapsesBefore: 0,
    stateBefore: "NEW",
    ...overrides,
  });
}

describe("StatsService", () => {
  let fake: FakePrisma;
  let service: StatsService;

  beforeEach(() => {
    fake = new FakePrisma();
    service = new StatsService(fake.asPrisma());
  });

  it("summarises recent reviews and groups them by the puzzle's themes", async () => {
    seedPuzzle(fake, "p1", ["fork"], 2);
    seedPuzzle(fake, "p2", ["pin"], 4);
    seedCard(fake, { id: "c1", puzzleId: "p1" });
    seedCard(fake, { id: "c2", puzzleId: "p2" });
    seedReview(fake, { id: "r1", puzzleId: "p1", cardId: "c1", correct: true });
    seedReview(fake, { id: "r2", puzzleId: "p2", cardId: "c2", correct: false });

    const stats = await service.get(USER, QUERY);

    expect(stats.completed).toBe(2);
    expect(stats.accuracy).toBe(0.5);
    expect(stats.groups).toEqual([
      { key: "fork", count: 1, accuracy: 1 },
      { key: "pin", count: 1, accuracy: 0 },
    ]);
  });

  it("counts as due only the states the queue builder would actually serve", async () => {
    seedPuzzle(fake, "p1", [], 1);
    seedPuzzle(fake, "p2", [], 1);
    seedPuzzle(fake, "p3", [], 1);
    // Due by date, but NEW cards are served from the new-card budget, not the review queue.
    seedCard(fake, { id: "c1", puzzleId: "p1", state: "NEW", dueAt: HOUR_AGO });
    seedCard(fake, { id: "c2", puzzleId: "p2", state: "REVIEW", dueAt: HOUR_AGO });
    seedCard(fake, { id: "c3", puzzleId: "p3", state: "REVIEW", dueAt: new Date(NOW.getTime() + 86_400_000) });

    expect((await service.get(USER, QUERY)).dueNow).toBe(1);
  });

  it("reports the new-card budget the queue builder would honour, net of today's new reviews", async () => {
    fake.settings.push({ userId: USER, timezone: "UTC", dayRolloverHour: 0, newPerDay: 3, reviewsPerDay: null });
    seedPuzzle(fake, "p1", [], 1);
    seedCard(fake, { id: "c1", puzzleId: "p1" });
    seedReview(fake, { id: "r1", puzzleId: "p1", cardId: "c1", stateBefore: "NEW" });
    // A review of an already-learned card spends the review budget, not the new one.
    seedReview(fake, { id: "r2", puzzleId: "p1", cardId: "c1", stateBefore: "REVIEW" });

    expect((await service.get(USER, QUERY)).remainingNewToday).toBe(2);
  });

  it("scopes every number to the caller", async () => {
    seedPuzzle(fake, "p1", ["fork"], 1);
    seedCard(fake, { id: "c1", puzzleId: "p1", state: "REVIEW", dueAt: HOUR_AGO, userId: "someone-else" });
    seedReview(fake, { id: "r1", puzzleId: "p1", cardId: "c1", userId: "someone-else" });

    const stats = await service.get(USER, QUERY);

    expect(stats.completed).toBe(0);
    expect(stats.dueNow).toBe(0);
    expect(stats.groups).toEqual([]);
  });

  it("rejects a window longer than the cap, including one left open-ended at `from`", async () => {
    const today = civilDateFor(NOW, "UTC", 0);

    await expect(service.get(USER, { ...QUERY, from: "1990-01-01" })).rejects.toThrow(
      `Range must span at most ${MAX_STATS_WINDOW_DAYS} days`,
    );
    await expect(service.get(USER, { ...QUERY, from: "1990-01-01", to: today })).rejects.toThrow();
  });

  it("defaults to a 30-day history ending today", async () => {
    const history = (await service.get(USER, QUERY)).history;

    expect(history).toHaveLength(30);
    expect(history[29]?.date).toBe(civilDateFor(NOW, "UTC", 0));
  });
});
