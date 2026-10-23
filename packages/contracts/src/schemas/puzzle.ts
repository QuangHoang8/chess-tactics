import { z } from "zod";
import { createZodDto } from "../create-zod-dto";

export const actorSchema = z.enum(["SOLVER", "OPPONENT"]);
export type ActorValue = z.infer<typeof actorSchema>;

/**
 * Plan §4.5: `TreeNode = {san, actor, isPrimary, comment?, children: TreeNode[]}`.
 * Self-referencing, so `z.infer` cannot derive the type on its own -- the interface is written
 * out explicitly and the schema is annotated with it via `z.lazy`.
 */
export interface TreeNodeInput {
  san: string;
  actor: ActorValue;
  isPrimary: boolean;
  // zod's `.optional()` infers `string | undefined`, not an omittable key -- kept consistent with
  // that here under exactOptionalPropertyTypes; converters at the domain boundary (puzzle-tree.ts)
  // narrow this to the omittable-key shape domain's SolutionTreeInput expects.
  comment?: string | undefined;
  children: TreeNodeInput[];
}

export const treeNodeInputSchema: z.ZodType<TreeNodeInput> = z.lazy(() =>
  z.object({
    san: z.string().min(1),
    actor: actorSchema,
    isPrimary: z.boolean(),
    comment: z.string().optional(),
    children: z.array(treeNodeInputSchema),
  }),
);

export const createPuzzleRequestSchema = z.object({
  fen: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
  themes: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  source: z.string().optional(),
  explanation: z.string().optional(),
  moves: z.array(treeNodeInputSchema),
});
export type CreatePuzzleRequest = z.infer<typeof createPuzzleRequestSchema>;
export class CreatePuzzleRequestDto extends createZodDto(createPuzzleRequestSchema) {}

/** Plan §4.5: PATCH body is the same shape, all fields optional. */
export const updatePuzzleRequestSchema = z.object({
  fen: z.string().min(1).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  themes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  explanation: z.string().optional(),
  moves: z.array(treeNodeInputSchema).optional(),
});
export type UpdatePuzzleRequest = z.infer<typeof updatePuzzleRequestSchema>;
export class UpdatePuzzleRequestDto extends createZodDto(updatePuzzleRequestSchema) {}

/** Mirrors packages/domain's ValidationWarning union (plan §3.4) -- contracts has no dependency on
 * domain, so this shape is kept in sync by hand, the same way SolutionTreeInput/TreeNode are. */
export const puzzleWarningSchema = z.union([
  z.object({
    type: z.literal("uncovered_opponent_reply"),
    ply: z.number(),
    fen: z.string(),
    missingReplies: z.array(z.string()),
  }),
  z.object({
    type: z.literal("ends_in_draw"),
    ply: z.number(),
    reason: z.string(),
  }),
]);
export type PuzzleWarning = z.infer<typeof puzzleWarningSchema>;

export const createPuzzleResponseSchema = z.object({
  id: z.string(),
  coverageWarnings: z.array(puzzleWarningSchema),
});
export type CreatePuzzleResponse = z.infer<typeof createPuzzleResponseSchema>;

export const updatePuzzleResponseSchema = createPuzzleResponseSchema;
export type UpdatePuzzleResponse = CreatePuzzleResponse;

/** A persisted move-tree node, as stored (plan §4 `PuzzleMove`) -- `san` is already normalised. */
export interface PuzzleMoveNode {
  id: string;
  san: string;
  actor: ActorValue;
  isPrimary: boolean;
  comment?: string | undefined;
  children: PuzzleMoveNode[];
}

export const puzzleMoveNodeSchema: z.ZodType<PuzzleMoveNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    san: z.string(),
    actor: actorSchema,
    isPrimary: z.boolean(),
    comment: z.string().optional(),
    children: z.array(puzzleMoveNodeSchema),
  }),
);

export const puzzleCardSummarySchema = z.object({
  state: z.enum(["NEW", "LEARNING", "REVIEW", "RELEARNING"]),
  dueAt: z.string(),
});

export const puzzleSummarySchema = z.object({
  id: z.string(),
  fen: z.string(),
  sideToMove: z.enum(["w", "b"]),
  difficulty: z.number(),
  source: z.string().optional(),
  explanation: z.string().optional(),
  themes: z.array(z.string()),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  card: puzzleCardSummarySchema.optional(),
});
export type PuzzleSummary = z.infer<typeof puzzleSummarySchema>;

export const puzzleDetailSchema = puzzleSummarySchema.extend({
  moves: z.array(puzzleMoveNodeSchema),
});
export type PuzzleDetail = z.infer<typeof puzzleDetailSchema>;

/** Plan §4.5: `GET /puzzles` query. Query strings arrive as strings, so numeric/array fields are
 * coerced rather than type-checked -- a plain `z.number()` would 422 every real request. */
export const listPuzzlesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  themes: z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  tags: z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
  source: z.string().optional(),
  q: z.string().optional(),
  sort: z.enum(["created", "difficulty", "due"]).default("created"),
});
export type ListPuzzlesQuery = z.infer<typeof listPuzzlesQuerySchema>;
export class ListPuzzlesQueryDto extends createZodDto(listPuzzlesQuerySchema) {}

export const listPuzzlesResponseSchema = z.object({
  items: z.array(puzzleSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListPuzzlesResponse = z.infer<typeof listPuzzlesResponseSchema>;
