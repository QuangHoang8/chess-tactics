/**
 * Plan §3.8: "today" is the civil date in `timezone`, after shifting the instant back by
 * `dayRolloverHour`. At `dayRolloverHour = 0` (the owner's chosen default) this reduces to the
 * plain civil date, so a session at 00:30 local counts against the new day.
 *
 * DST is handled by `Intl.DateTimeFormat` formatting directly in the target zone -- no manual
 * UTC-offset arithmetic is needed, and none is attempted here. That is deliberate: hand-rolled
 * offset math is exactly the kind of thing that double-counts or skips a day across a DST
 * transition, which is one of this function's own acceptance criteria (plan §6).
 */
export function civilDateFor(instant: Date, timezone: string, dayRolloverHour: number): string {
  const shifted = new Date(instant.getTime() - dayRolloverHour * 3_600_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

/** Convenience for the api's daily-cap counting (plan §4.3): are `a` and `b` on the same training day? */
export function isSameTrainingDay(a: Date, b: Date, timezone: string, dayRolloverHour: number): boolean {
  return civilDateFor(a, timezone, dayRolloverHour) === civilDateFor(b, timezone, dayRolloverHour);
}
