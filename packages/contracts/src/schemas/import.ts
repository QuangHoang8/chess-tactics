import { z } from "zod";
import { createZodDto } from "../create-zod-dto";

export const importKindSchema = z.enum(["JSON", "CSV", "PGN"]);
export type ImportKindValue = z.infer<typeof importKindSchema>;

export const pgnImportModeSchema = z.enum(["WHOLE_GAME", "EXTRACT_PLIES"]);
export type PgnImportModeValue = z.infer<typeof pgnImportModeSchema>;

export const importStatusSchema = z.enum(["PENDING", "PREVIEWED", "COMMITTED", "FAILED"]);
export type ImportStatusValue = z.infer<typeof importStatusSchema>;

/**
 * Plan §4.5: `POST /imports` is multipart, so every field arrives as a string however it was
 * typed on the client -- `plies` is coerced from a repeated field or a comma-separated list
 * rather than type-checked, the same way `listPuzzlesQuerySchema` handles query strings.
 */
export const createImportRequestSchema = z.object({
  kind: importKindSchema,
  mode: pgnImportModeSchema.optional(),
  plies: z
    .union([z.array(z.union([z.string(), z.number()])), z.string(), z.number()])
    .transform((value) =>
      (Array.isArray(value) ? value : [value])
        .flatMap((entry) => String(entry).split(","))
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "")
        .map(Number),
    )
    .pipe(z.array(z.number().int().min(0)))
    .optional(),
});
export type CreateImportRequest = z.infer<typeof createImportRequestSchema>;
export class CreateImportRequestDto extends createZodDto(createImportRequestSchema) {}

/** Plan §4.5: `ImportRecord = {index, status, fen?, message?, duplicateOfPuzzleId?}`. */
export const importRecordSchema = z.object({
  index: z.number().int(),
  status: z.enum(["ACCEPTED", "REJECTED", "DUPLICATE"]),
  fen: z.string().optional(),
  message: z.string().optional(),
  duplicateOfPuzzleId: z.string().optional(),
});
export type ImportRecord = z.infer<typeof importRecordSchema>;

export const importBatchResponseSchema = z.object({
  batchId: z.string(),
  kind: importKindSchema,
  status: importStatusSchema,
  sourceName: z.string().optional(),
  totalRows: z.number().int(),
  acceptedRows: z.number().int(),
  rejectedRows: z.number().int(),
  report: z.array(importRecordSchema),
  createdAt: z.string(),
});
export type ImportBatchResponse = z.infer<typeof importBatchResponseSchema>;

export const commitImportRequestSchema = z.object({
  skipIndices: z.array(z.number().int()).optional(),
});
export type CommitImportRequest = z.infer<typeof commitImportRequestSchema>;
export class CommitImportRequestDto extends createZodDto(commitImportRequestSchema) {}

export const commitImportResponseSchema = z.object({
  batchId: z.string(),
  status: importStatusSchema,
  created: z.number().int(),
  skipped: z.number().int(),
});
export type CommitImportResponse = z.infer<typeof commitImportResponseSchema>;

/** Plan §4.5/§5 3.6: `GET /puzzles/export?format=json|csv`, optionally carrying cards and reviews. */
export const exportPuzzlesQuerySchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  includeCards: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  includeReviews: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});
export type ExportPuzzlesQuery = z.infer<typeof exportPuzzlesQuerySchema>;
export class ExportPuzzlesQueryDto extends createZodDto(exportPuzzlesQuerySchema) {}
