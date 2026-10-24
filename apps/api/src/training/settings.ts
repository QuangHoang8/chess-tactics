import type { PrismaService } from "../prisma/prisma.service";

/** Plan §4's UserSettings defaults (§12 owner overrides), used when no row exists yet -- Phase 4
 * reads settings but nothing creates the row (that lands with Phase 5's settings UI). */
const DEFAULT_SETTINGS: EffectiveSettings = {
  timezone: "UTC",
  dayRolloverHour: 0,
  newPerDay: 20,
  reviewsPerDay: null,
};

export interface EffectiveSettings {
  timezone: string;
  dayRolloverHour: number;
  newPerDay: number;
  reviewsPerDay: number | null;
}

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
