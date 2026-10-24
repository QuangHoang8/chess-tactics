import { Body, Controller, Get, Patch } from "@nestjs/common";
import { UpdateSettingsRequestDto, type UserSettings } from "@chess-tactics/contracts";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/jwt.strategy";
import { SettingsService } from "./settings.service";

@Controller("settings")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser): Promise<UserSettings> {
    return this.settingsService.get(user.userId);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateSettingsRequestDto,
  ): Promise<UserSettings> {
    return this.settingsService.update(user.userId, body);
  }
}
