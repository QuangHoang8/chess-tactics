import { Body, Controller, Get, HttpStatus, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  TrainingAttemptRequestDto,
  TrainingHintRequestDto,
  TrainingReviewRequestDto,
  TrainingSkipRequestDto,
  type TrainingAttemptResponse,
  type TrainingHintResponse,
  type TrainingNextResponse,
  type TrainingReviewResponse,
  type TrainingSkipResponse,
} from "@chess-tactics/contracts";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/jwt.strategy";
import { TrainingService } from "./training.service";

@Controller("training")
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Get("next")
  async next(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TrainingNextResponse | undefined> {
    const result = await this.trainingService.getNext(user.userId);
    if (!result) {
      // Plan §4.5: 204 when the queue is empty, so the client branches on status, not payload.
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return result;
  }

  @Post("attempt")
  attempt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TrainingAttemptRequestDto,
  ): Promise<TrainingAttemptResponse> {
    return this.trainingService.attempt(user.userId, body);
  }

  @Post("hint")
  hint(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TrainingHintRequestDto,
  ): Promise<TrainingHintResponse> {
    return this.trainingService.hint(user.userId, body);
  }

  @Post("skip")
  skip(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TrainingSkipRequestDto,
  ): Promise<TrainingSkipResponse> {
    return this.trainingService.skip(user.userId, body);
  }

  @Post("review")
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TrainingReviewRequestDto,
  ): Promise<TrainingReviewResponse> {
    return this.trainingService.review(user.userId, body);
  }
}
