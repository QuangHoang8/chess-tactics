import { z } from "zod";
import { createZodDto } from "../create-zod-dto";

/** Reviews with no explicit `from` are counted over this many civil days back, inclusive of today. */
export const DEFAULT_STATS_WINDOW_DAYS = 30;

/**
 * Reviews of puzzles carrying no themes are bucketed here under `groupBy=theme`, rather than
 * dropped. A puzzle may carry several themes and its review then counts once under each, so theme
 * group counts sum to at least `completed`, not exactly to it -- `groupBy=difficulty` is the
 * partition that sums exactly.
 */
export const UNTHEMED_GROUP_KEY = "(none)";

/**
 * Plan §4.5: `GET /stats?from&to&groupBy=theme|difficulty`. `from`/`to` are civil dates
 * (`YYYY-MM-DD`) in the caller's configured timezone, not instants -- the whole series is keyed by
 * the same civil date `packages/domain`'s `civilDateFor` produces, so a range bound expressed as an
 * instant would not line up with the buckets it filters.
 */
const civilDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

/** `history` carries one point per day in the window, so an unbounded range is an unbounded
 * response. A year and a day is past any dashboard's usefulness and well short of trouble. The cap
 * is enforced by the api against the *resolved* window, since `to` defaults to today and an
 * open-ended `from` would otherwise slip past a check made on the query alone. */
export const MAX_STATS_WINDOW_DAYS = 366;

export const statsQuerySchema = z
  .object({
    from: civilDateSchema.optional(),
    to: civilDateSchema.optional(),
    groupBy: z.enum(["theme", "difficulty"]).default("theme"),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    path: ["from"],
    message: "`from` must not be after `to`",
  });
export type StatsQuery = z.infer<typeof statsQuerySchema>;
export class StatsQueryDto extends createZodDto(statsQuerySchema) {}

export const statsGroupSchema = z.object({
  key: z.string(),
  count: z.number(),
  accuracy: z.number(),
});
export type StatsGroup = z.infer<typeof statsGroupSchema>;

export const statsHistoryPointSchema = z.object({
  date: z.string(),
  reviews: z.number(),
  accuracy: z.number(),
});
export type StatsHistoryPoint = z.infer<typeof statsHistoryPointSchema>;

/**
 * `completed` counts `ReviewLog` rows inside the window, and `accuracy` is the fraction of those
 * whose `correct` flag is set -- the objective solve-quality signal training.service.ts records,
 * not the player's self-chosen rating. Every `count`/`accuracy` pair below means the same thing
 * over a narrower slice. Accuracy over zero reviews is reported as 0.
 *
 * `dueNow` and `remainingNewToday` are *not* windowed: they describe the queue right now, which is
 * what the dashboard is actually asked for.
 */
export const statsResponseSchema = z.object({
  completed: z.number(),
  accuracy: z.number(),
  dueNow: z.number(),
  remainingNewToday: z.number(),
  groups: z.array(statsGroupSchema),
  history: z.array(statsHistoryPointSchema),
});
export type StatsResponse = z.infer<typeof statsResponseSchema>;
