import { addCivilDays, civilDateFor } from "@chess-tactics/domain";
import {
  UNTHEMED_GROUP_KEY,
  type StatsGroup,
  type StatsHistoryPoint,
  type StatsQuery,
} from "@chess-tactics/contracts";
import type { EffectiveSettings } from "../settings/effective-settings";

/** One review, joined to the puzzle metadata the breakdowns group by. */
export interface AggregableReview {
  reviewedAt: Date;
  correct: boolean;
  themes: string[];
  difficulty: number;
}

export interface Breakdown {
  completed: number;
  accuracy: number;
  groups: StatsGroup[];
  history: StatsHistoryPoint[];
}

/**
 * Plan §5.1/§5.2. Pure, like `srs.ts` and `day.ts`: the caller hands over the rows and the
 * timezone, and the windowing is applied here rather than in SQL, because the window is expressed
 * in civil dates and only `civilDateFor` can map an instant onto one (`queue.ts` overfetches by
 * UTC range for the same reason).
 */
export function summarise(
  reviews: readonly AggregableReview[],
  dates: readonly string[],
  settings: EffectiveSettings,
  groupBy: StatsQuery["groupBy"],
): Breakdown {
  const inWindow = new Set(dates);
  const dated = reviews
    .map((review) => ({
      review,
      date: civilDateFor(review.reviewedAt, settings.timezone, settings.dayRolloverHour),
    }))
    .filter((entry) => inWindow.has(entry.date));

  const correct = dated.filter((entry) => entry.review.correct).length;

  return {
    completed: dated.length,
    accuracy: accuracyOf(correct, dated.length),
    groups: groupsOf(
      dated.map((entry) => entry.review),
      groupBy,
    ),
    history: dates.map((date) => {
      const onDate = dated.filter((entry) => entry.date === date);
      return {
        date,
        reviews: onDate.length,
        accuracy: accuracyOf(onDate.filter((entry) => entry.review.correct).length, onDate.length),
      };
    }),
  };
}

export interface StatsWindow {
  from: string;
  to: string;
}

/** The civil-date range `GET /stats` reports over: whatever bounds the caller gave, with `to`
 * defaulting to today and `from` to the start of the trailing `windowDays`. */
export function resolveWindow(
  now: Date,
  settings: EffectiveSettings,
  query: Pick<StatsQuery, "from" | "to">,
  windowDays: number,
): StatsWindow {
  const to = query.to ?? civilDateFor(now, settings.timezone, settings.dayRolloverHour);
  return { from: query.from ?? addCivilDays(to, -(windowDays - 1)), to };
}

function accuracyOf(correct: number, total: number): number {
  return total === 0 ? 0 : correct / total;
}

function groupsOf(reviews: readonly AggregableReview[], groupBy: StatsQuery["groupBy"]): StatsGroup[] {
  const tally = new Map<string, { count: number; correct: number }>();

  for (const review of reviews) {
    for (const key of keysOf(review, groupBy)) {
      const bucket = tally.get(key) ?? { count: 0, correct: 0 };
      bucket.count += 1;
      bucket.correct += review.correct ? 1 : 0;
      tally.set(key, bucket);
    }
  }

  return [...tally]
    .map(([key, bucket]) => ({ key, count: bucket.count, accuracy: accuracyOf(bucket.correct, bucket.count) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function keysOf(review: AggregableReview, groupBy: StatsQuery["groupBy"]): string[] {
  if (groupBy === "difficulty") {
    return [String(review.difficulty)];
  }
  return review.themes.length > 0 ? review.themes : [UNTHEMED_GROUP_KEY];
}
