import { describe, expect, it } from "vitest";
import { civilDateFor, isSameTrainingDay } from "./day";

describe("civilDateFor", () => {
  it("with dayRolloverHour=0, equals the plain civil date", () => {
    expect(civilDateFor(new Date("2026-06-15T00:30:00.000Z"), "UTC", 0)).toBe("2026-06-15");
    expect(civilDateFor(new Date("2026-06-14T23:59:00.000Z"), "UTC", 0)).toBe("2026-06-14");
  });

  it("with dayRolloverHour=4 (the plan's original rationale), a 00:30 local session counts against the previous day", () => {
    // Same wall-clock instant as above, but a non-zero rollover hour is still supported (§6: "the
    // helper still accepts a non-zero dayRolloverHour ... since the schema and settings UI leave
    // it configurable per user").
    expect(civilDateFor(new Date("2026-06-15T00:30:00.000Z"), "UTC", 4)).toBe("2026-06-14");
    // Once past the rollover hour, it's the new day again.
    expect(civilDateFor(new Date("2026-06-15T04:30:00.000Z"), "UTC", 4)).toBe("2026-06-15");
  });

  it("respects a non-UTC timezone", () => {
    // 2026-01-01T23:00Z is 2026-01-02T08:00 in Asia/Tokyo (UTC+9).
    expect(civilDateFor(new Date("2026-01-01T23:00:00.000Z"), "Asia/Tokyo", 0)).toBe("2026-01-02");
  });

  it("does not double-count or skip a day across a DST spring-forward transition", () => {
    // 2026-03-08 is the US spring-forward date (America/New_York: 02:00 EST -> 03:00 EDT), so
    // local midnight March 8 is 05:00 UTC (EST=UTC-5) and local midnight March 9 is 04:00 UTC the
    // next day (EDT=UTC-4) -- March 8 is a 23-hour local day. Sample hourly from local midnight
    // March 8 through an hour into March 9.
    const start = Date.UTC(2026, 2, 8, 5, 0, 0);
    const hours = Array.from({ length: 30 }, (_, i) =>
      civilDateFor(new Date(start + i * 3_600_000), "America/New_York", 0),
    );

    const uniqueInOrder = [...new Set(hours)];
    // Exactly two calendar days appear across this window, in order -- i.e. the sequence never
    // jumps back to the earlier day after advancing, and the 23-hour local day isn't skipped.
    expect(uniqueInOrder).toEqual(["2026-03-08", "2026-03-09"]);
    const firstOfNextDay = hours.indexOf("2026-03-09");
    expect(hours.slice(firstOfNextDay)).toEqual(hours.slice(firstOfNextDay).map(() => "2026-03-09"));
  });

  it("does not double-count or skip a day across a DST fall-back transition", () => {
    // 2026-11-01 is the US fall-back date (America/New_York: 02:00 EDT -> 01:00 EST), so local
    // midnight Nov 1 is 04:00 UTC (EDT=UTC-4) and local midnight Nov 2 is 05:00 UTC the next day
    // (EST=UTC-5) -- Nov 1 is a 25-hour local day (01:00-02:00 happens twice) but the calendar
    // date must still advance exactly once.
    const start = Date.UTC(2026, 10, 1, 4, 0, 0);
    const hours = Array.from({ length: 27 }, (_, i) =>
      civilDateFor(new Date(start + i * 3_600_000), "America/New_York", 0),
    );
    expect([...new Set(hours)]).toEqual(["2026-11-01", "2026-11-02"]);
  });
});

describe("isSameTrainingDay", () => {
  it("is true for two instants on the same civil day", () => {
    const a = new Date("2026-06-15T01:00:00.000Z");
    const b = new Date("2026-06-15T23:00:00.000Z");
    expect(isSameTrainingDay(a, b, "UTC", 0)).toBe(true);
  });

  it("is false across midnight", () => {
    const a = new Date("2026-06-15T23:59:00.000Z");
    const b = new Date("2026-06-16T00:01:00.000Z");
    expect(isSameTrainingDay(a, b, "UTC", 0)).toBe(false);
  });
});
