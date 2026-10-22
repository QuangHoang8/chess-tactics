import { z } from "zod";
import { createZodDto } from "../create-zod-dto";

export const moveInputSchema = z.object({
  from: z.string(),
  to: z.string(),
  promotion: z.enum(["n", "b", "r", "q"]).optional(),
});
export type MoveInput = z.infer<typeof moveInputSchema>;

export const trainingNextResponseSchema = z.object({
  sessionId: z.string(),
  puzzleId: z.string(),
  fen: z.string(),
  sideToMove: z.enum(["w", "b"]),
  boardOrientation: z.enum(["white", "black"]),
  hintsAvailable: z.boolean(),
  isResume: z.boolean(),
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
});
export type TrainingAttemptResponse = z.infer<typeof trainingAttemptResponseSchema>;
