import { z } from "zod";
import { importRecordSchema, treeNodeInputSchema } from "@chess-tactics/contracts";

/**
 * What a previewed-but-not-yet-committed record needs for `POST /imports/:id/commit` to create
 * it. The tree here has already been through `validateSolution`, so its SAN is canonical
 * (plan §3.2) and commit does not re-parse the uploaded file -- which is no longer available.
 */
const acceptedPayloadSchema = z.object({
  fen: z.string(),
  sideToMove: z.string(),
  difficulty: z.number().int(),
  themes: z.array(z.string()),
  tags: z.array(z.string()),
  source: z.string().optional(),
  explanation: z.string().optional(),
  tree: z.array(treeNodeInputSchema),
});
export type AcceptedPayload = z.infer<typeof acceptedPayloadSchema>;

/**
 * `ImportBatch.report` holds this, not the bare `ImportRecord[]` of plan §4.5 -- `records` is
 * the part returned on the wire, and the rest is what commit needs. Reading it back goes through
 * the schema rather than a cast, so a corrupt row fails loudly instead of half-importing.
 */
export const storedReportSchema = z.object({
  records: z.array(importRecordSchema),
  /** Keyed by `ImportRecord.index`; JSON object keys are strings. */
  accepted: z.record(z.string(), acceptedPayloadSchema),
  /** Present once committed, so replaying a commit returns the original counts. */
  commit: z.object({ created: z.number().int(), skipped: z.number().int() }).optional(),
});
export type StoredReport = z.infer<typeof storedReportSchema>;
