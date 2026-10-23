import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from "@nestjs/common";
import {
  CreatePuzzleRequestDto,
  ExportPuzzlesQueryDto,
  ListPuzzlesQueryDto,
  UpdatePuzzleRequestDto,
  type CreatePuzzleResponse,
  type ListPuzzlesResponse,
  type PuzzleDetail,
  type UpdatePuzzleResponse,
} from "@chess-tactics/contracts";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/jwt.strategy";
import { PuzzlesExportService } from "./puzzles-export.service";
import { PuzzlesService } from "./puzzles.service";

@Controller("puzzles")
export class PuzzlesController {
  constructor(
    private readonly puzzlesService: PuzzlesService,
    private readonly exportService: PuzzlesExportService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreatePuzzleRequestDto,
  ): Promise<CreatePuzzleResponse> {
    return this.puzzlesService.create(user.userId, body);
  }

  @Get()
  findMany(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPuzzlesQueryDto,
  ): Promise<ListPuzzlesResponse> {
    return this.puzzlesService.findMany(user.userId, query);
  }

  // Declared before `:id`, which would otherwise match "export" first.
  @Get("export")
  exportAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportPuzzlesQueryDto,
  ): StreamableFile {
    return this.exportService.export(user.userId, query);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string): Promise<PuzzleDetail> {
    return this.puzzlesService.findOne(user.userId, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: UpdatePuzzleRequestDto,
  ): Promise<UpdatePuzzleResponse> {
    return this.puzzlesService.update(user.userId, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string): Promise<void> {
    return this.puzzlesService.remove(user.userId, id);
  }
}
