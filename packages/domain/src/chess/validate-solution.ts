import { Chess, validateFen } from "chess.js";
import type {
  CoverageWarning,
  SolutionTreeInput,
  TerminalDrawWarning,
  ValidatedTreeNode,
  ValidateSolutionResult,
  ValidationError,
  ValidationWarning,
} from "./types";

/**
 * Per plan §3.4: validateFen first, try/catch per-ply move application (chess.js throws on an
 * illegal move, it never returns null), checkmate vs. draw terminal classification, and a
 * coverage warning when a position's legal opponent replies aren't all configured.
 *
 * On success, returns the tree with each `san` replaced by its chess.js-normalised canonical
 * form (plan §3.2) -- this is the shape callers persist, not the raw input.
 */
export function validateSolution(fen: string, tree: SolutionTreeInput[]): ValidateSolutionResult {
  const fenCheck = validateFen(fen);
  if (!fenCheck.ok) {
    return { ok: false, errors: [{ ply: 0, input: fen, message: fenCheck.error ?? "Invalid FEN" }] };
  }

  // §3.4 defect: an empty move list must be rejected, not silently accepted.
  if (tree.length === 0) {
    return {
      ok: false,
      errors: [{ ply: 1, input: "", message: "At least one SOLVER move is required at the root" }],
    };
  }

  const nonSolverRoot = tree.find((node) => node.actor !== "SOLVER");
  if (nonSolverRoot) {
    return {
      ok: false,
      errors: [{ ply: 1, input: nonSolverRoot.san, message: "Root moves must be SOLVER moves" }],
    };
  }

  const sideToMove = new Chess(fen).turn();
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const normalisedTree = walk(tree, fen, 1, errors, warnings);

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, sideToMove, tree: normalisedTree, warnings };
}

function walk(
  nodes: SolutionTreeInput[],
  parentFen: string,
  ply: number,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): ValidatedTreeNode[] {
  const result: ValidatedTreeNode[] = [];

  for (const node of nodes) {
    const chess = new Chess(parentFen);
    let normalisedSan: string;
    try {
      normalisedSan = chess.move(node.san).san;
    } catch (error) {
      errors.push({ ply, input: node.san, message: messageOf(error) });
      // No legal resulting position to validate this node's children against -- skip the subtree.
      continue;
    }

    const resultingFen = chess.fen();

    if (node.children.length === 0) {
      pushTerminalWarningIfDrawn(chess, ply, normalisedSan, warnings);
    } else {
      pushCoverageWarningIfIncomplete(node, resultingFen, ply, warnings);
    }

    const children = walk(node.children, resultingFen, ply + 1, errors, warnings);

    result.push({
      san: normalisedSan,
      actor: node.actor,
      isPrimary: node.isPrimary,
      ...(node.comment !== undefined ? { comment: node.comment } : {}),
      children,
    });
  }

  return result;
}

function pushTerminalWarningIfDrawn(
  chess: Chess,
  ply: number,
  san: string,
  warnings: ValidationWarning[],
): void {
  // §3.4 defect: isGameOver() is true for draws too, not just mate. A terminal node must
  // distinguish checkmate from a drawn ending (e.g. insufficient material) and flag the latter.
  if (!chess.isCheckmate() && chess.isDraw()) {
    const warning: TerminalDrawWarning = {
      type: "ends_in_draw",
      ply,
      reason: `Solution ends in a draw after ${san}, not checkmate`,
    };
    warnings.push(warning);
  }
}

function pushCoverageWarningIfIncomplete(
  node: SolutionTreeInput,
  resultingFen: string,
  ply: number,
  warnings: ValidationWarning[],
): void {
  const opponentChildren = node.children.filter((child) => child.actor === "OPPONENT");
  if (opponentChildren.length === 0) {
    return;
  }

  const legalReplies = new Chess(resultingFen).moves();
  const covered = new Set(
    opponentChildren
      .map((child) => normalizedSanOrNull(resultingFen, child.san))
      .filter((san): san is string => san !== null),
  );
  const missingReplies = legalReplies.filter((san) => !covered.has(san));

  if (missingReplies.length > 0) {
    const warning: CoverageWarning = {
      type: "uncovered_opponent_reply",
      ply: ply + 1,
      fen: resultingFen,
      missingReplies,
    };
    warnings.push(warning);
  }
}

function normalizedSanOrNull(fen: string, san: string): string | null {
  try {
    return new Chess(fen).move(san).san;
  } catch {
    return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid move";
}
