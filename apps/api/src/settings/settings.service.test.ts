import { beforeEach, describe, expect, it } from "vitest";
import { FakePrisma } from "../test-support/fake-prisma";
import { DEFAULT_SETTINGS } from "./effective-settings";
import { SettingsService } from "./settings.service";

const USER = "user-1";

describe("SettingsService", () => {
  let fake: FakePrisma;
  let service: SettingsService;

  beforeEach(() => {
    fake = new FakePrisma();
    service = new SettingsService(fake.asPrisma());
  });

  it("reports the defaults the queue builder is already using when no row exists", async () => {
    expect(await service.get(USER)).toEqual(DEFAULT_SETTINGS);
    expect(fake.settings).toHaveLength(0);
  });

  it("creates the row on first write, filling unmentioned fields from those same defaults", async () => {
    const saved = await service.update(USER, { newPerDay: 5 });

    expect(saved).toEqual({ ...DEFAULT_SETTINGS, newPerDay: 5 });
    expect(fake.settings).toEqual([{ userId: USER, ...DEFAULT_SETTINGS, newPerDay: 5 }]);
  });

  it("leaves fields the patch does not mention alone on a later write", async () => {
    await service.update(USER, { timezone: "Asia/Tokyo", dayRolloverHour: 4 });
    const saved = await service.update(USER, { newPerDay: 7 });

    expect(saved).toEqual({ timezone: "Asia/Tokyo", dayRolloverHour: 4, newPerDay: 7, reviewsPerDay: null });
  });

  it("treats an explicit null as clearing the review cap, not as an absent field", async () => {
    await service.update(USER, { reviewsPerDay: 50 });
    expect((await service.get(USER)).reviewsPerDay).toBe(50);

    await service.update(USER, { reviewsPerDay: null });
    expect((await service.get(USER)).reviewsPerDay).toBeNull();
  });

  it("keeps a zero rollover hour, which a nullish fallback would overwrite", async () => {
    await service.update(USER, { dayRolloverHour: 6 });
    const saved = await service.update(USER, { dayRolloverHour: 0 });

    expect(saved.dayRolloverHour).toBe(0);
  });
});
