import { Injectable } from "@nestjs/common";
import type { UpdateSettingsRequest, UserSettings } from "@chess-tactics/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { getEffectiveSettings } from "./effective-settings";

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Plan §4.5 `GET /settings`. Reports the defaults rather than 404ing when no row exists --
   * those defaults are what the queue builder is using, so they are the truthful answer. */
  get(userId: string): Promise<UserSettings> {
    return getEffectiveSettings(this.prisma, userId);
  }

  /**
   * Plan §4.5 `PATCH /settings`. Upserts, because the row is created lazily: a user who has never
   * saved settings has been training on `DEFAULT_SETTINGS`, so the row this first write creates
   * must start from those same values or an unmentioned field would silently change meaning.
   */
  async update(userId: string, patch: UpdateSettingsRequest): Promise<UserSettings> {
    const current = await this.get(userId);
    const next: UserSettings = {
      timezone: patch.timezone ?? current.timezone,
      dayRolloverHour: patch.dayRolloverHour ?? current.dayRolloverHour,
      newPerDay: patch.newPerDay ?? current.newPerDay,
      // Not `??`: an explicit null is the caller clearing the cap, which `??` would discard.
      reviewsPerDay: patch.reviewsPerDay === undefined ? current.reviewsPerDay : patch.reviewsPerDay,
    };

    const row = await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...next },
      update: next,
    });

    return {
      timezone: row.timezone,
      dayRolloverHour: row.dayRolloverHour,
      newPerDay: row.newPerDay,
      reviewsPerDay: row.reviewsPerDay,
    };
  }
}
