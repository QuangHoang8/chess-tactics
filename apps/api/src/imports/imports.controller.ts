import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  CommitImportRequestDto,
  CreateImportRequestDto,
  type CommitImportResponse,
  type ImportBatchResponse,
} from "@chess-tactics/contracts";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/jwt.strategy";
import { ImportsService, type UploadedImportFile } from "./imports.service";

@Controller("imports")
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file"))
  create(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedImportFile | undefined,
    @Body() body: CreateImportRequestDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<ImportBatchResponse> {
    if (!file) {
      throw new BadRequestException("A file is required");
    }
    // Plan §4.5 maps this header onto ImportBatch.idempotencyKey, which is not nullable: without
    // it a replayed upload would import the same file twice.
    if (!idempotencyKey) {
      throw new BadRequestException("An Idempotency-Key header is required");
    }

    return this.importsService.preview(user.userId, { ...body, file, idempotencyKey });
  }

  @Post(":id/commit")
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: CommitImportRequestDto,
  ): Promise<CommitImportResponse> {
    return this.importsService.commit(user.userId, id, body);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string): Promise<ImportBatchResponse> {
    return this.importsService.findOne(user.userId, { id });
  }
}
