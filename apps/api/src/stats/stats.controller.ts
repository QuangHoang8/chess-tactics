import { Controller, Get, Query } from "@nestjs/common";
import { StatsQueryDto, type StatsResponse } from "@chess-tactics/contracts";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/jwt.strategy";
import { StatsService } from "./stats.service";

@Controller("stats")
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Query() query: StatsQueryDto): Promise<StatsResponse> {
    return this.statsService.get(user.userId, query);
  }
}
