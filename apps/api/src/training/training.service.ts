import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PuzzleCard, PuzzleMove, TrainingSession } from "@prisma/client";
import { applyMove, applySan, schedule, type SchedulingCard } from "@chess-tactics/domain";
import type {
  TrainingAttemptRequest,
  TrainingAttemptResponse,
  TrainingHintRequest,
  TrainingHintResponse,
  TrainingNextResponse,
  TrainingReviewRequest,
  TrainingReviewResponse,
  TrainingSkipRequest,
  TrainingSkipResponse,
} from "@chess-tactics/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { getEffectiveSettings } from "../settings/effective-settings";
import { pickNextCard } from "./queue";
import { primaryLine, primaryOf, resolveFen, solverCandidates } from "./solution-tree";

/** Beyond this, an `endedAt: null` row is treated as abandoned rather than resumable (plan §4.6) --
 * a crashed/forgotten tab should not permanently shadow the queue builder. */
const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

const PIECE_NAMES: Record<string, string> = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight" };

@Injectable()
export class TrainingService {
  constructor(private readonly prisma: PrismaService) {}

  async getNext(userId: string): Promise<TrainingNextResponse | null> {
    const now = new Date();
    const resumed = await this.tryResume(userId, now);
    if (resumed) {
      return resumed;
    }

    const settings = await getEffectiveSettings(this.prisma, userId);
    const card = await pickNextCard(this.prisma, userId, settings, now);
    if (!card) {
      return null;
    }

    const session = await this.prisma.trainingSession.create({
      data: { userId, currentPuzzleId: card.puzzleId },
    });

    const sideToMove = card.puzzle.sideToMove === "b" ? "b" : "w";
    return {
      sessionId: session.id,
      puzzleId: card.puzzleId,
      fen: card.puzzle.fen,
      sideToMove,
      boardOrientation: sideToMove === "w" ? "white" : "black",
      hintsAvailable: true,
      isResume: false,
      solved: false,
    };
  }

  async attempt(userId: string, request: TrainingAttemptRequest): Promise<TrainingAttemptResponse> {
    const session = await this.requireActiveSession(userId, request.sessionId, request.puzzleId);
    const puzzle = await this.prisma.puzzle.findUniqueOrThrow({ where: { id: request.puzzleId } });
    const currentFen = await resolveFen(this.prisma, puzzle.id, puzzle.fen, session.currentNodeId);

    // Zod's `.optional()` infers `promotion?: T | undefined`; domain's MoveInput (under
    // exactOptionalPropertyTypes) wants the key omitted entirely rather than set to undefined.
    const { from, to, promotion } = request.move;
    const moveInput = promotion === undefined ? { from, to } : { from, to, promotion };

    const applied = applyMove(currentFen, moveInput);
    if (!applied.ok) {
      // Rules-illegal move: rejected, no state change beyond recording the attempt.
      return this.rejected(session);
    }

    const candidates = await solverCandidates(this.prisma, puzzle.id, session.currentNodeId);
    const matched = candidates.find((candidate) => candidate.san === applied.san);
    if (!matched) {
      // Legal chess move, but not one of this puzzle's accepted lines: rejected.
      return this.rejected(session);
    }

    const opponentReplies = await this.prisma.puzzleMove.findMany({
      where: { parentId: matched.id, actor: "OPPONENT" },
    });

    if (opponentReplies.length === 0) {
      await this.prisma.trainingSession.update({
        where: { id: session.id },
        data: { currentNodeId: matched.id, solved: true },
      });
      return {
        accepted: true,
        normalisedSan: applied.san,
        fen: applied.fen,
        solved: true,
        remainingPlies: 0,
        ...(puzzle.explanation !== null ? { explanation: puzzle.explanation } : {}),
      };
    }

    const opponentNode = primaryOf(opponentReplies);
    if (!opponentNode) {
      throw new Error(`Unreachable: opponentReplies had ${opponentReplies.length} elements`);
    }

    const opponentApplied = applySan(applied.fen, opponentNode.san);
    if (!opponentApplied.ok) {
      // A stored opponent SAN that fails to apply is a data/seed bug, not a user error.
      throw new Error(
        `Stored opponent move "${opponentNode.san}" (PuzzleMove ${opponentNode.id}) is illegal ` +
          `from ${applied.fen}: ${opponentApplied.error}`,
      );
    }

    await this.prisma.trainingSession.update({
      where: { id: session.id },
      data: { currentNodeId: opponentNode.id },
    });

    return {
      accepted: true,
      normalisedSan: applied.san,
      fen: applied.fen,
      opponentReply: { san: opponentNode.san, fen: opponentApplied.fen },
      solved: false,
      remainingPlies: await this.countPrimaryChain(opponentNode.id),
    };
  }

  async hint(userId: string, request: TrainingHintRequest): Promise<TrainingHintResponse> {
    const session = await this.requireActiveSession(userId, request.sessionId, request.puzzleId);
    const puzzle = await this.prisma.puzzle.findUniqueOrThrow({ where: { id: request.puzzleId } });

    if (request.level === 1) {
      const text =
        puzzle.themes.length > 0 ? `Theme: ${puzzle.themes.join(", ")}.` : "No themes recorded for this puzzle.";
      return { level: 1, text };
    }

    const candidates = await solverCandidates(this.prisma, puzzle.id, session.currentNodeId);
    const next = primaryOf(candidates);
    if (!next) {
      throw new BadRequestException("This puzzle has no further moves to hint -- it's already solved");
    }

    if (request.level === 2) {
      return { level: 2, text: `The next move is played by a ${pieceNameFromSan(next.san)}.` };
    }
    return { level: 3, text: `The next move is ${next.san}.` };
  }

  async skip(userId: string, request: TrainingSkipRequest): Promise<TrainingSkipResponse> {
    const session = await this.requireActiveSession(userId, request.sessionId, request.puzzleId);
    const puzzle = await this.prisma.puzzle.findUniqueOrThrow({ where: { id: request.puzzleId } });
    const solutionLine = await primaryLine(this.prisma, puzzle.id);

    await this.prisma.trainingSession.update({ where: { id: session.id }, data: { skipped: true } });

    return {
      solutionLine,
      ...(puzzle.explanation !== null ? { explanation: puzzle.explanation } : {}),
    };
  }

  async review(userId: string, request: TrainingReviewRequest): Promise<TrainingReviewResponse> {
    const session = await this.requireActiveSession(userId, request.sessionId, request.puzzleId);
    if (!session.solved && !session.skipped) {
      throw new BadRequestException("Puzzle must be solved or skipped before it can be reviewed");
    }

    const card = await this.prisma.puzzleCard.findFirst({ where: { userId, puzzleId: request.puzzleId } });
    if (!card) {
      throw new NotFoundException("Puzzle card not found");
    }

    const now = new Date();
    const result = schedule(toSchedulingCard(card), request.rating, now);
    // Plan §3.5's ReviewLog.correct is an objective solve-quality signal, independent of the
    // player's self-chosen rating: a skip, or any rejected attempt along the way, means they did
    // not solve it cleanly even if they later pick a generous rating.
    const correct = session.solved && !session.skipped && !session.hadRejectedAttempt;

    await this.prisma.$transaction(async (tx) => {
      await tx.reviewLog.create({
        data: {
          userId,
          puzzleId: request.puzzleId,
          cardId: card.id,
          rating: request.rating,
          correct,
          hintsUsed: request.hintsUsed,
          durationMs: request.durationMs,
          reviewedAt: now,
          elapsedDays: result.elapsedDays,
          scheduledDays: result.scheduledDays,
          intervalBefore: card.intervalDays,
          easeBefore: card.easeFactor,
          repsBefore: card.repetitions,
          lapsesBefore: card.lapses,
          stateBefore: card.state,
        },
      });
      await tx.puzzleCard.update({
        where: { id: card.id },
        data: {
          state: result.state,
          dueAt: result.dueAt,
          intervalDays: result.intervalDays,
          easeFactor: result.easeFactor,
          repetitions: result.repetitions,
          lapses: result.lapses,
          learningStep: result.learningStep,
          lastReviewedAt: now,
        },
      });
      await tx.trainingSession.update({ where: { id: session.id }, data: { endedAt: now } });
    });

    return {
      nextDueAt: result.dueAt.toISOString(),
      intervalDays: result.intervalDays,
      easeFactor: result.easeFactor,
      state: result.state,
    };
  }

  /** Plan §4.6: resumes the most recent still-open session, replaying its FEN from the stored
   * move tree. A session that is stale (past RESUME_WINDOW_MS) or whose card has disappeared is
   * closed out instead of resumed, so it stops shadowing future getNext() calls. */
  private async tryResume(userId: string, now: Date): Promise<TrainingNextResponse | null> {
    const open = await this.prisma.trainingSession.findFirst({
      where: { userId, endedAt: null },
      orderBy: { startedAt: "desc" },
    });
    if (!open) {
      return null;
    }

    const stale = now.getTime() - open.startedAt.getTime() > RESUME_WINDOW_MS;
    const card = open.currentPuzzleId
      ? await this.prisma.puzzleCard.findFirst({
          where: { userId, puzzleId: open.currentPuzzleId },
          include: { puzzle: true },
        })
      : null;

    if (stale || !card) {
      await this.prisma.trainingSession.update({ where: { id: open.id }, data: { endedAt: now } });
      return null;
    }

    const fen = await resolveFen(this.prisma, card.puzzleId, card.puzzle.fen, open.currentNodeId);
    const sideToMove = card.puzzle.sideToMove === "b" ? "b" : "w";
    return {
      sessionId: open.id,
      puzzleId: card.puzzleId,
      fen,
      sideToMove,
      boardOrientation: sideToMove === "w" ? "white" : "black",
      hintsAvailable: true,
      isResume: true,
      // A skip also leaves nothing left to solve, so a resumed-after-skip session must show the
      // rating UI too, not a draggable board with no further moves to make -- review() already
      // accepts either solved or skipped as the gate.
      solved: open.solved || open.skipped,
    };
  }

  private async requireActiveSession(
    userId: string,
    sessionId: string,
    puzzleId: string,
  ): Promise<TrainingSession> {
    const session = await this.prisma.trainingSession.findUnique({ where: { id: sessionId } });
    if (!session || session.endedAt !== null) {
      throw new NotFoundException("Training session not found or expired");
    }
    if (session.userId !== userId) {
      throw new ForbiddenException();
    }
    if (session.currentPuzzleId !== puzzleId) {
      throw new NotFoundException("Puzzle does not match this session");
    }
    return session;
  }

  private async rejected(session: TrainingSession): Promise<TrainingAttemptResponse> {
    await this.prisma.trainingSession.update({
      where: { id: session.id },
      data: { hadRejectedAttempt: true },
    });
    return {
      accepted: false,
      solved: false,
      remainingPlies: await this.countPrimaryChain(session.currentNodeId, session.currentPuzzleId ?? undefined),
    };
  }

  /** Counts remaining SOLVER nodes down the primary line, for UI progress hinting only. */
  private async countPrimaryChain(nodeId: string | null, puzzleId?: string): Promise<number> {
    if (nodeId === null) {
      if (puzzleId === undefined) {
        throw new Error("countPrimaryChain requires puzzleId when nodeId is null");
      }
      const roots = await this.prisma.puzzleMove.findMany({ where: { puzzleId, parentId: null } });
      return this.countFromChildren(roots);
    }
    const children = await this.prisma.puzzleMove.findMany({ where: { parentId: nodeId } });
    return this.countFromChildren(children);
  }

  private async countFromChildren(children: PuzzleMove[]): Promise<number> {
    const found = children.find((child) => child.isPrimary);
    const primary = found ?? children[0];
    if (!primary) {
      return 0;
    }
    const ownCount = primary.actor === "SOLVER" ? 1 : 0;
    return ownCount + (await this.countPrimaryChain(primary.id));
  }
}

function toSchedulingCard(card: PuzzleCard): SchedulingCard {
  return {
    state: card.state,
    intervalDays: card.intervalDays,
    easeFactor: card.easeFactor,
    repetitions: card.repetitions,
    lapses: card.lapses,
    learningStep: card.learningStep,
    lastReviewedAt: card.lastReviewedAt,
  };
}

function pieceNameFromSan(san: string): string {
  const clean = san.replace(/[+#!?]+$/g, "");
  if (clean === "O-O" || clean === "O-O-O") {
    return "king";
  }
  const first = clean[0];
  return first && first in PIECE_NAMES ? (PIECE_NAMES[first] ?? "pawn") : "pawn";
}
