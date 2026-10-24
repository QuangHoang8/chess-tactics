import { Body, Controller, Get, Post } from "@nestjs/common";
import {
  BackupDocumentDto,
  type BackupDocument,
  type RestoreResponse,
} from "@chess-tactics/contracts";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/jwt.strategy";
import { BackupService } from "./backup.service";

@Controller()
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get("backup")
  backup(@CurrentUser() user: AuthenticatedUser): Promise<BackupDocument> {
    return this.backupService.backup(user.userId);
  }

  @Post("restore")
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: BackupDocumentDto,
  ): Promise<RestoreResponse> {
    return this.backupService.restore(user.userId, body);
  }
}
