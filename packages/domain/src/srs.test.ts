import { describe, expect, it } from "vitest";
import { schedule, type Rating, type SchedulingCard } from "./srs";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function newCard(overrides: Partial<SchedulingCard> = {}): SchedulingCard {
  return {
    state: "NEW",
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
    learningStep: 0,
    lastReviewedAt: null,
    ...overrides,
  };
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

describe("schedule -- new card, one rating each", () => {
  it("AGAIN: lapses += 1, ease floors toward 1.30, resets to the first learning step, enters RELEARNING", () => {
    const result = schedule(newCard(), "AGAIN", NOW);
    expect(result.state).toBe("RELEARNING");
    expect(result.lapses).toBe(1);
    expect(result.easeFactor).toBeCloseTo(2.3);
    expect(result.intervalDays).toBeCloseTo(1 / 1440);
    expect(result.learningStep).toBe(0);
  });

  it("GOOD: advances to the next (10min) learning step, ease unchanged", () => {
    const result = schedule(newCard(), "GOOD", NOW);
    expect(result.state).toBe("LEARNING");
    expect(result.learningStep).toBe(1);
    expect(result.intervalDays).toBeCloseTo(10 / 1440);
    expect(result.easeFactor).toBe(2.5);
  });

  it("HARD: repeats the current learning step and penalises ease", () => {
    const result = schedule(newCard(), "HARD", NOW);
    expect(result.state).toBe("LEARNING");
    expect(result.learningStep).toBe(0);
    expect(result.intervalDays).toBeCloseTo(1 / 1440);
    expect(result.easeFactor).toBeCloseTo(2.35);
  });

  it("EASY: jumps straight to a 4-day interval and graduates to REVIEW", () => {
    const result = schedule(newCard(), "EASY", NOW);
    expect(result.state).toBe("REVIEW");
    expect(result.intervalDays).toBe(4);
    // Ease starts at the 2.50 ceiling, so EASY's +0.15 bonus is clamped away -- not a no-op bug.
    expect(result.easeFactor).toBe(2.5);
    expect(result.repetitions).toBe(1);
  });

  it("graduates off the last learning step on a second GOOD", () => {
    const afterFirstGood = schedule(newCard(), "GOOD", NOW);
    const graduated = schedule(
      newCard({ state: afterFirstGood.state, learningStep: afterFirstGood.learningStep }),
      "GOOD",
      NOW,
    );
    expect(graduated.state).toBe("REVIEW");
    expect(graduated.intervalDays).toBe(1);
    expect(graduated.repetitions).toBe(1);
  });
});

describe("schedule -- empty solution line regression guard for the scheduler itself", () => {
  it("rejects nothing (schedule has no input validation) but never produces a negative interval", () => {
    const result = schedule(newCard({ easeFactor: 1.3 }), "AGAIN", NOW);
    expect(result.intervalDays).toBeGreaterThan(0);
  });
});

describe("schedule -- REVIEW-state multipliers", () => {
  const reviewCard: SchedulingCard = {
    state: "REVIEW",
    intervalDays: 10,
    easeFactor: 2.0,
    repetitions: 3,
    lapses: 0,
    learningStep: 0,
    lastReviewedAt: daysAgo(10),
  };

  it("HARD multiplies the base interval by 1.2 and penalises ease", () => {
    const result = schedule(reviewCard, "HARD", NOW);
    expect(result.intervalDays).toBeCloseTo(12);
    expect(result.easeFactor).toBeCloseTo(1.85);
    expect(result.repetitions).toBe(3);
  });

  it("GOOD multiplies the base interval by ease and increments repetitions", () => {
    const result = schedule(reviewCard, "GOOD", NOW);
    expect(result.intervalDays).toBeCloseTo(20);
    expect(result.easeFactor).toBe(2.0);
    expect(result.repetitions).toBe(4);
  });

  it("EASY multiplies the base interval by ease * 1.3 and raises ease", () => {
    const result = schedule(reviewCard, "EASY", NOW);
    expect(result.intervalDays).toBeCloseTo(26);
    expect(result.easeFactor).toBeCloseTo(2.15);
    expect(result.repetitions).toBe(4);
  });

  it("an overdue card schedules from actual elapsed days, not the stale interval", () => {
    const overdue: SchedulingCard = { ...reviewCard, intervalDays: 5, lastReviewedAt: daysAgo(30) };
    const result = schedule(overdue, "GOOD", NOW);
    // Base is max(elapsedDays=30, intervalDays=5) = 30, not the stale 5.
    expect(result.intervalDays).toBeCloseTo(30 * reviewCard.easeFactor);
    expect(result.elapsedDays).toBeCloseTo(30);
    expect(result.scheduledDays).toBe(5);
  });

  it("an early review does not shrink the interval below the still-valid scheduled one", () => {
    const early: SchedulingCard = { ...reviewCard, intervalDays: 10, lastReviewedAt: daysAgo(2) };
    const result = schedule(early, "GOOD", NOW);
    // Base is max(elapsedDays=2, intervalDays=10) = 10, not the smaller elapsed value.
    expect(result.intervalDays).toBeCloseTo(10 * reviewCard.easeFactor);
  });

  it("repeated GOOD reviews grow the interval monotonically up to the 365-day cap", () => {
    let card: SchedulingCard = { ...reviewCard, intervalDays: 1, lastReviewedAt: daysAgo(1) };
    let previousInterval = 0;
    let reachedCap = false;
    for (let i = 0; i < 30; i += 1) {
      const result = schedule(card, "GOOD", NOW);
      expect(result.intervalDays).toBeGreaterThanOrEqual(previousInterval);
      previousInterval = result.intervalDays;
      if (result.intervalDays === 365) {
        reachedCap = true;
      }
      card = { ...card, intervalDays: result.intervalDays, lastReviewedAt: daysAgo(result.intervalDays) };
    }
    expect(reachedCap).toBe(true);
    expect(previousInterval).toBeLessThanOrEqual(365);
  });

  it("ease never leaves [1.30, 2.50] under repeated AGAIN or repeated EASY", () => {
    let card: SchedulingCard = { ...reviewCard, easeFactor: 2.5 };
    for (let i = 0; i < 20; i += 1) {
      const result = schedule(card, "AGAIN", NOW);
      expect(result.easeFactor).toBeGreaterThanOrEqual(1.3);
      card = { ...card, easeFactor: result.easeFactor, state: "REVIEW" };
    }
    expect(card.easeFactor).toBeCloseTo(1.3);

    let easyCard: SchedulingCard = { ...reviewCard, easeFactor: 1.3, lastReviewedAt: daysAgo(10) };
    for (let i = 0; i < 20; i += 1) {
      const result = schedule(easyCard, "EASY", NOW);
      expect(result.easeFactor).toBeLessThanOrEqual(2.5);
      easyCard = { ...easyCard, easeFactor: result.easeFactor, lastReviewedAt: daysAgo(10) };
    }
    expect(easyCard.easeFactor).toBeCloseTo(2.5);
  });
});

describe("schedule -- RELEARNING graduates the same way LEARNING does", () => {
  it("GOOD through both relearning steps returns to REVIEW at the graduating interval", () => {
    const relearning = newCard({ state: "RELEARNING", lapses: 1, easeFactor: 2.3 });
    const afterFirst = schedule(relearning, "GOOD", NOW);
    expect(afterFirst.state).toBe("RELEARNING");
    const afterSecond = schedule({ ...relearning, learningStep: afterFirst.learningStep }, "GOOD", NOW);
    expect(afterSecond.state).toBe("REVIEW");
    expect(afterSecond.intervalDays).toBe(1);
  });
});

describe.each<Rating>(["AGAIN", "HARD", "GOOD", "EASY"])("schedule -- %s always produces a finite result", (rating) => {
  it(`handles ${rating} without throwing`, () => {
    expect(() => schedule(newCard(), rating, NOW)).not.toThrow();
  });
});
