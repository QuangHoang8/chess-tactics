import { describe, expect, it } from "vitest";
import { civilDateRange } from "@chess-tactics/domain";
import { UNTHEMED_GROUP_KEY } from "@chess-tactics/contracts";
import type { EffectiveSettings } from "../settings/effective-settings";
import { resolveWindow, summarise, type AggregableReview } from "./aggregate";

const UTC: EffectiveSettings = { timezone: "UTC", dayRolloverHour: 0, newPerDay: 20, reviewsPerDay: null };

function review(overrides: Partial<AggregableReview> = {}): AggregableReview {
  return {
    reviewedAt: new Date("2026-06-15T12:00:00.000Z"),
    correct: true,
    themes: ["fork"],
    difficulty: 3,
    ...overrides,
  };
}

describe("resolveWindow", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("defaults to the trailing window ending today, inclusive of both ends", () => {
    const window = resolveWindow(now, UTC, {}, 30);
    expect(window).toEqual({ from: "2026-05-17", to: "2026-06-15" });
    expect(civilDateRange(window.from, window.to)).toHaveLength(30);
  });

  it("anchors the default `from` to an explicit `to`, not to today", () => {
    expect(resolveWindow(now, UTC, { to: "2026-03-10" }, 7)).toEqual({ from: "2026-03-04", to: "2026-03-10" });
  });

  it("takes today from the caller's own timezone", () => {
    const tokyo: EffectiveSettings = { ...UTC, timezone: "Asia/Tokyo" };
    // 23:00Z on the 15th is already the 16th in Tokyo.
    const window = resolveWindow(new Date("2026-06-15T23:00:00.000Z"), tokyo, {}, 1);
    expect(window).toEqual({ from: "2026-06-16", to: "2026-06-16" });
  });
});

describe("summarise", () => {
  const dates = civilDateRange("2026-06-14", "2026-06-16");

  it("counts reviews in the window and reports accuracy as the correct fraction", () => {
    const result = summarise(
      [review({ correct: true }), review({ correct: true }), review({ correct: false })],
      dates,
      UTC,
      "theme",
    );
    expect(result.completed).toBe(3);
    expect(result.accuracy).toBeCloseTo(2 / 3);
  });

  it("excludes reviews whose civil date falls outside the window", () => {
    const result = summarise(
      [
        review({ reviewedAt: new Date("2026-06-13T23:59:00.000Z") }),
        review({ reviewedAt: new Date("2026-06-14T00:00:00.000Z") }),
        review({ reviewedAt: new Date("2026-06-17T00:00:00.000Z") }),
      ],
      dates,
      UTC,
      "theme",
    );
    expect(result.completed).toBe(1);
  });

  it("places a review in the day its own timezone puts it in", () => {
    const tokyo: EffectiveSettings = { ...UTC, timezone: "Asia/Tokyo" };
    // 2026-06-15T23:00Z is 2026-06-16T08:00 in Tokyo.
    const at = new Date("2026-06-15T23:00:00.000Z");
    expect(summarise([review({ reviewedAt: at })], dates, UTC, "theme").history[1]?.reviews).toBe(1);
    expect(summarise([review({ reviewedAt: at })], dates, tokyo, "theme").history[2]?.reviews).toBe(1);
  });

  it("reports accuracy as 0 rather than NaN when nothing was reviewed", () => {
    const result = summarise([], dates, UTC, "theme");
    expect(result.accuracy).toBe(0);
    expect(result.history.every((point) => point.accuracy === 0 && point.reviews === 0)).toBe(true);
  });

  it("emits one history point per day in the window, zeroes included, in order", () => {
    const result = summarise([review()], dates, UTC, "theme");
    expect(result.history.map((point) => point.date)).toEqual(["2026-06-14", "2026-06-15", "2026-06-16"]);
    expect(result.history.map((point) => point.reviews)).toEqual([0, 1, 0]);
  });

  it("counts a multi-theme review once under each of its themes", () => {
    const result = summarise([review({ themes: ["fork", "pin"] })], dates, UTC, "theme");
    expect(result.groups).toEqual([
      { key: "fork", count: 1, accuracy: 1 },
      { key: "pin", count: 1, accuracy: 1 },
    ]);
    expect(result.completed).toBe(1);
  });

  it("buckets reviews of unthemed puzzles rather than dropping them", () => {
    const result = summarise([review({ themes: [] })], dates, UTC, "theme");
    expect(result.groups).toEqual([{ key: UNTHEMED_GROUP_KEY, count: 1, accuracy: 1 }]);
  });

  it("partitions exactly by difficulty, so the group counts sum to `completed`", () => {
    const result = summarise(
      [
        review({ difficulty: 1, correct: true }),
        review({ difficulty: 1, correct: false }),
        review({ difficulty: 4, correct: true }),
      ],
      dates,
      UTC,
      "difficulty",
    );
    expect(result.groups).toEqual([
      { key: "1", count: 2, accuracy: 0.5 },
      { key: "4", count: 1, accuracy: 1 },
    ]);
    expect(result.groups.reduce((sum, group) => sum + group.count, 0)).toBe(result.completed);
  });

  it("orders groups by review count, then by key", () => {
    const result = summarise(
      [review({ themes: ["zugzwang"] }), review({ themes: ["pin"] }), review({ themes: ["pin"] })],
      dates,
      UTC,
      "theme",
    );
    expect(result.groups.map((group) => group.key)).toEqual(["pin", "zugzwang"]);
  });
});
