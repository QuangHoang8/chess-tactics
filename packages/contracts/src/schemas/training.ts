import { z } from "zod";
import { createZodDto } from "../create-zod-dto";

export const moveInputSchema = z.object({
  from: z.string(),
  to: z.string(),
  promotion: z.enum(["n", "b", "r", "q"]).optional(),
});
export type MoveInput = z.infer<typeof moveInputSchema>;

/** Mirrors Prisma's Rating enum (plan §3.5) -- contracts has no dependency on @prisma/client, so
 * this is kept in sync by hand, the same way puzzle.ts's actorSchema mirrors Actor. */
export const ratingSchema = z.enum(["AGAIN", "HARD", "GOOD", "EASY"]);
export type RatingValue = z.infer<typeof ratingSchema>;

/** Mirrors Prisma's CardState enum (plan §4). */
export const cardStateSchema = z.enum(["NEW", "LEARNING", "REVIEW", "RELEARNING"]);
export type CardStateValue = z.infer<typeof cardStateSchema>;

export const trainingNextResponseSchema = z.object({
  sessionId: z.string(),
  puzzleId: z.string(),
  fen: z.string(),
  sideToMove: z.enum(["w", "b"]),
  boardOrientation: z.enum(["white", "black"]),
  hintsAvailable: z.boolean(),
  isResume: z.boolean(),
  /** True when resuming a session that was already solved but not yet reviewed (plan §4.6) --
   * the client should show the rating UI immediately instead of waiting for a move. */
  solved: z.boolean(),
});
export type TrainingNextResponse = z.infer<typeof trainingNextResponseSchema>;

export const trainingAttemptRequestSchema = z.object({
  sessionId: z.string(),
  puzzleId: z.string(),
  move: moveInputSchema,
});
export type TrainingAttemptRequest = z.infer<typeof trainingAttemptRequestSchema>;
export class TrainingAttemptRequestDto extends createZodDto(trainingAttemptRequestSchema) {}

export const trainingAttemptResponseSchema = z.object({
  accepted: z.boolean(),
  normalisedSan: z.string().optional(),
  /** Position right after the accepted solver move (before any opponent auto-reply). */
  fen: z.string().optional(),
  opponentReply: z.object({ san: z.string(), fen: z.string() }).optional(),
  solved: z.boolean(),
  remainingPlies: z.number(),
  /** Plan §4.5 Phase 4.5: "explanation on completion" -- present only when `solved` is true. */
  explanation: z.string().optional(),
});
export type TrainingAttemptResponse = z.infer<typeof trainingAttemptResponseSchema>;

export const trainingHintRequestSchema = z.object({
  sessionId: z.string(),
  puzzleId: z.string(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
export type TrainingHintRequest = z.infer<typeof trainingHintRequestSchema>;
export class TrainingHintRequestDto extends createZodDto(trainingHintRequestSchema) {}

export const trainingHintResponseSchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: z.string(),
});
export type TrainingHintResponse = z.infer<typeof trainingHintResponseSchema>;

export const trainingSkipRequestSchema = z.object({
  sessionId: z.string(),
  puzzleId: z.string(),
});
export type TrainingSkipRequest = z.infer<typeof trainingSkipRequestSchema>;
export class TrainingSkipRequestDto extends createZodDto(trainingSkipRequestSchema) {}

export const trainingSkipResponseSchema = z.object({
  solutionLine: z.array(z.string()),
  explanation: z.string().optional(),
});
export type TrainingSkipResponse = z.infer<typeof trainingSkipResponseSchema>;

export const trainingReviewRequestSchema = z.object({
  sessionId: z.string(),
  puzzleId: z.string(),
  rating: ratingSchema,
  hintsUsed: z.number().int().min(0),
  durationMs: z.number().int().min(0),
});
export type TrainingReviewRequest = z.infer<typeof trainingReviewRequestSchema>;
export class TrainingReviewRequestDto extends createZodDto(trainingReviewRequestSchema) {}

export const trainingReviewResponseSchema = z.object({
  nextDueAt: z.string(),
  intervalDays: z.number(),
  easeFactor: z.number(),
  state: cardStateSchema,
});
export type TrainingReviewResponse = z.infer<typeof trainingReviewResponseSchema>;
