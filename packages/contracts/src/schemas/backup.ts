import { z } from "zod";
import { createZodDto } from "../create-zod-dto";
import { cardStateSchema, ratingSchema } from "./training";
import { actorSchema } from "./puzzle";
import { userSettingsSchema } from "./settings";

/** Bumped whenever the document shape changes incompatibly; `POST /restore` rejects anything else
 * rather than guessing at an older layout. */
export const BACKUP_FORMAT_VERSION = 1;

const isoDateTimeSchema = z.string().datetime();

/**
 * The tables are flat rather than nested, and every primary key travels with its row, because
 * restore has to rebuild `PuzzleMove.parentId` (the solution tree, plan §3.3) and
 * `ReviewLog.cardId` exactly as they were. A nested document would force restore to re-mint ids
 * and re-derive those links.
 *
 * `Puzzle.importBatchId` is deliberately absent: `ImportBatch` is a record of an import run, not
 * training data, and §5.4 scopes the document to "puzzles + moves + cards + review logs +
 * settings". Restored puzzles carry no batch.
 */
export const backupPuzzleSchema = z.object({
  id: z.string(),
  fen: z.string(),
  sideToMove: z.enum(["w", "b"]),
  difficulty: z.number().int(),
  source: z.string().nullable(),
  explanation: z.string().nullable(),
  themes: z.array(z.string()),
  tags: z.array(z.string()),
  dedupeHash: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type BackupPuzzle = z.infer<typeof backupPuzzleSchema>;

export const backupMoveSchema = z.object({
  id: z.string(),
  puzzleId: z.string(),
  parentId: z.string().nullable(),
  ply: z.number().int(),
  san: z.string(),
  actor: actorSchema,
  isPrimary: z.boolean(),
  comment: z.string().nullable(),
});
export type BackupMove = z.infer<typeof backupMoveSchema>;

export const backupCardSchema = z.object({
  id: z.string(),
  puzzleId: z.string(),
  state: cardStateSchema,
  dueAt: isoDateTimeSchema,
  intervalDays: z.number(),
  easeFactor: z.number(),
  repetitions: z.number().int(),
  lapses: z.number().int(),
  learningStep: z.number().int(),
  lastReviewedAt: isoDateTimeSchema.nullable(),
});
export type BackupCard = z.infer<typeof backupCardSchema>;

/** Every `ReviewLog` column from plan §3.5 travels, including the FSRS optimiser inputs that no
 * other export carries. `stateBefore` in particular is what the queue builder's daily new-vs-review
 * split reads, so a document without it could not reproduce the stats it was taken from. */
export const backupReviewLogSchema = z.object({
  id: z.string(),
  puzzleId: z.string(),
  cardId: z.string(),
  rating: ratingSchema,
  correct: z.boolean(),
  hintsUsed: z.number().int(),
  durationMs: z.number().int(),
  reviewedAt: isoDateTimeSchema,
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  intervalBefore: z.number(),
  easeBefore: z.number(),
  repsBefore: z.number().int(),
  lapsesBefore: z.number().int(),
  stateBefore: cardStateSchema,
});
export type BackupReviewLog = z.infer<typeof backupReviewLogSchema>;

export const backupDocumentSchema = z.object({
  version: z.literal(BACKUP_FORMAT_VERSION),
  exportedAt: isoDateTimeSchema,
  settings: userSettingsSchema.nullable(),
  puzzles: z.array(backupPuzzleSchema),
  moves: z.array(backupMoveSchema),
  cards: z.array(backupCardSchema),
  reviewLogs: z.array(backupReviewLogSchema),
});
export type BackupDocument = z.infer<typeof backupDocumentSchema>;
export class BackupDocumentDto extends createZodDto(backupDocumentSchema) {}

export const restoreResponseSchema = z.object({
  restored: z.object({
    puzzles: z.number(),
    moves: z.number(),
    cards: z.number(),
    logs: z.number(),
  }),
});
export type RestoreResponse = z.infer<typeof restoreResponseSchema>;
