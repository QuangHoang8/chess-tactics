import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PuzzleMove } from "@prisma/client";
import { applyMove, applySan } from "@chess-tactics/domain";
import type {
  TrainingAttemptRequest,
  TrainingAttemptResponse,
  TrainingNextResponse,
} from "@chess-tactics/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { TrainingSessionProgress, TrainingSessionStore } from "./training-session-store";

@Injectable()
export class TrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: TrainingSessionStore,
  ) {}

  async getNext(userId: string): Promise<TrainingNextResponse | null> {
    // Phase 1 simplification: serve NEW cards in insertion order. Overdue-first prioritisation
    // and the newPerDay/reviewsPerDay caps (plan §4.3) land in Phase 4.
    const card = await this.prisma.puzzleCard.findFirst({
      where: { userId, state: "NEW" },
      orderBy: { puzzle: { createdAt: "asc" } },
      include: { puzzle: true },
    });

    if (!card) {
      return null;
    }

    const sessionId = randomUUID();
    this.sessions.create(sessionId, {
      userId,
      puzzleId: card.puzzleId,
      currentNodeId: null,
      currentFen: card.puzzle.fen,
    });

    await this.prisma.trainingSession.create({
      data: { userId, currentPuzzleId: card.puzzleId },
    });

    const sideToMove = card.puzzle.sideToMove === "b" ? "b" : "w";
    return {
      sessionId,
      puzzleId: card.puzzleId,
      fen: card.puzzle.fen,
      sideToMove,
      boardOrientation: sideToMove === "w" ? "white" : "black",
      hintsAvailable: true,
      isResume: false,
    };
  }

  async attempt(userId: string, request: TrainingAttemptRequest): Promise<TrainingAttemptResponse> {
    const progress = this.requireSession(userId, request);

    // Zod's `.optional()` infers `promotion?: T | undefined`; domain's MoveInput (under
    // exactOptionalPropertyTypes) wants the key omitted entirely rather than set to undefined.
    const { from, to, promotion } = request.move;
    const moveInput = promotion === undefined ? { from, to } : { from, to, promotion };

    const applied = applyMove(progress.currentFen, moveInput);
    if (!applied.ok) {
      // Rules-illegal move: rejected, no state change (plan §4.5: "carries no state change").
      return this.rejected(progress);
    }

    const candidates = await this.prisma.puzzleMove.findMany({
      where: { puzzleId: progress.puzzleId, parentId: progress.currentNodeId, actor: "SOLVER" },
    });
    const matched = candidates.find((candidate) => candidate.san === applied.san);
    if (!matched) {
      // Legal chess move, but not one of this puzzle's accepted lines: rejected, no state change.
      return this.rejected(progress);
    }

    const opponentReplies = await this.prisma.puzzleMove.findMany({
      where: { parentId: matched.id, actor: "OPPONENT" },
    });

    if (opponentReplies.length === 0) {
      await this.markSolved(request.sessionId, progress.puzzleId);
      return { accepted: true, normalisedSan: applied.san, fen: applied.fen, solved: true, remainingPlies: 0 };
    }

    const opponentNode = opponentReplies.find((node) => node.isPrimary) ?? opponentReplies[0];
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

    this.sessions.update(request.sessionId, {
      ...progress,
      currentNodeId: opponentNode.id,
      currentFen: opponentApplied.fen,
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

  private requireSession(userId: string, request: TrainingAttemptRequest): TrainingSessionProgress {
    const progress = this.sessions.get(request.sessionId);
    if (!progress) {
      throw new NotFoundException("Training session not found or expired");
    }
    if (progress.userId !== userId) {
      throw new ForbiddenException();
    }
    if (progress.puzzleId !== request.puzzleId) {
      throw new NotFoundException("Puzzle does not match this session");
    }
    return progress;
  }

  private async rejected(progress: TrainingSessionProgress): Promise<TrainingAttemptResponse> {
    return {
      accepted: false,
      solved: false,
      remainingPlies: await this.countPrimaryChain(progress.currentNodeId, progress.puzzleId),
    };
  }

  private async markSolved(sessionId: string, puzzleId: string): Promise<void> {
    this.sessions.delete(sessionId);
    // Only a true fact is persisted here. Phase 1 has no review endpoint (that's Phase 4.4), so
    // no ReviewLog row and no SM-2 state change is written -- fabricating one would poison the
    // Phase 5 stats and a future FSRS migration with an invented rating.
    await this.prisma.puzzleCard.update({
      where: { puzzleId },
      data: { lastReviewedAt: new Date() },
    });
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
