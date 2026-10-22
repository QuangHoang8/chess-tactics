import { Injectable } from "@nestjs/common";

export interface TrainingSessionProgress {
  userId: string;
  puzzleId: string;
  /** null = at the puzzle root; no move has been played yet this session. */
  currentNodeId: string | null;
  currentFen: string;
}

/**
 * Ephemeral, in-memory only -- lost on server restart or across instances. This is a deliberate
 * Phase 1 simplification: the schema's TrainingSession.currentPuzzleId records which puzzle was
 * being trained, but not which node within its solution tree, so durable resume-after-refresh
 * (plan §4.6) needs its own migration and lands in Phase 4, not here.
 */
@Injectable()
export class TrainingSessionStore {
  private readonly sessions = new Map<string, TrainingSessionProgress>();

  create(sessionId: string, progress: TrainingSessionProgress): void {
    this.sessions.set(sessionId, progress);
  }

  get(sessionId: string): TrainingSessionProgress | undefined {
    return this.sessions.get(sessionId);
  }

  update(sessionId: string, progress: TrainingSessionProgress): void {
    this.sessions.set(sessionId, progress);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
