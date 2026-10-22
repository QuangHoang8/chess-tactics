import { Module } from "@nestjs/common";
import { TrainingController } from "./training.controller";
import { TrainingService } from "./training.service";
import { TrainingSessionStore } from "./training-session-store";

@Module({
  controllers: [TrainingController],
  providers: [TrainingService, TrainingSessionStore],
})
export class TrainingModule {}
