import { Module } from "@nestjs/common";
import { PuzzlesController } from "./puzzles.controller";
import { PuzzlesExportService } from "./puzzles-export.service";
import { PuzzlesService } from "./puzzles.service";

@Module({
  controllers: [PuzzlesController],
  providers: [PuzzlesService, PuzzlesExportService],
})
export class PuzzlesModule {}
