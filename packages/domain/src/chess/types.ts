export type Actor = "SOLVER" | "OPPONENT";

export type Side = "w" | "b";

/** Mirrors the API's TreeNode shape (plan §4.5) exactly, so contracts/api/domain share one shape. */
export interface SolutionTreeInput {
  san: string;
  actor: Actor;
  isPrimary: boolean;
  comment?: string;
  children: SolutionTreeInput[];
}

export interface ValidationError {
  ply: number;
  input: string;
  message: string;
}

export interface CoverageWarning {
  type: "uncovered_opponent_reply";
  ply: number;
  fen: string;
  missingReplies: string[];
}

export interface TerminalDrawWarning {
  type: "ends_in_draw";
  ply: number;
  reason: string;
}

export type ValidationWarning = CoverageWarning | TerminalDrawWarning;

/** Same shape as SolutionTreeInput, but `san` is chess.js-normalised (plan §3.2) -- ready to persist. */
export interface ValidatedTreeNode {
  san: string;
  actor: Actor;
  isPrimary: boolean;
  comment?: string;
  children: ValidatedTreeNode[];
}

export type ValidateSolutionResult =
  | { ok: true; sideToMove: Side; tree: ValidatedTreeNode[]; warnings: ValidationWarning[] }
  | { ok: false; errors: ValidationError[] };

export interface MoveInput {
  from: string;
  to: string;
  promotion?: "n" | "b" | "r" | "q";
}

export type ApplyMoveResult = { ok: true; san: string; fen: string } | { ok: false; error: string };

export type ApplySanResult = { ok: true; fen: string } | { ok: false; error: string };
