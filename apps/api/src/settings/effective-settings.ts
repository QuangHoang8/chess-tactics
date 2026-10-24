import type { UserSettings } from "@chess-tactics/contracts";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * Settings with defaults applied -- what the queue builder reads, whether or not the user has ever
 * saved a row. Structurally the wire shape, aliased so the two cannot drift.
 */
export type EffectiveSettings = UserSettings;

/** Plan §4's UserSettings defaults (§12 owner overrides). These mirror `@default` in
 * prisma/schema.prisma so a user who has never opened the settings page trains on the same values
 * a freshly-created row would give them. */
export const DEFAULT_SETTINGS: EffectiveSettings = {
  timezone: "UTC",
  dayRolloverHour: 0,
  newPerDay: 20,
  reviewsPerDay: null,
};

export async function getEffectiveSettings(prisma: PrismaService, userId: string): Promise<EffectiveSettings> {
  const row = await prisma.userSettings.findUnique({ where: { userId } });
  if (!row) {
    return DEFAULT_SETTINGS;
  }
  return {
    timezone: row.timezone,
    dayRolloverHour: row.dayRolloverHour,
    newPerDay: row.newPerDay,
    reviewsPerDay: row.reviewsPerDay,
  };
}
