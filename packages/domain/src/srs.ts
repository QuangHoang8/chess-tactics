export type Rating = "AGAIN" | "HARD" | "GOOD" | "EASY";

export type CardState = "NEW" | "LEARNING" | "REVIEW" | "RELEARNING";

/** The scheduling-relevant slice of a PuzzleCard row (plan §4). */
export interface SchedulingCard {
  state: CardState;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  /** Index into LEARNING_STEPS_DAYS; meaningful only while state is NEW/LEARNING/RELEARNING. */
  learningStep: number;
  /** null for a card that has never been reviewed. */
  lastReviewedAt: Date | null;
}

export interface ScheduleResult {
  state: CardState;
  dueAt: Date;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  learningStep: number;
  /** Days since the previous review (0 for a card's first-ever review). Plan §3.5 ReviewLog column. */
  elapsedDays: number;
  /** The interval the card was given last time, i.e. `card.intervalDays` before this update. */
  scheduledDays: number;
}

const MIN_EASE = 1.3;
const MAX_EASE = 2.5;
const MAX_INTERVAL_DAYS = 365;

const DAY_MS = 86_400_000;

// Plan §3.5: "New card -> learning steps [1min, 10min]".
const LEARNING_STEPS_DAYS = [1 / 1440, 10 / 1440];
const GRADUATING_INTERVAL_DAYS = 1;
const EASY_NEW_CARD_INTERVAL_DAYS = 4;

const AGAIN_EASE_PENALTY = 0.2;
const HARD_EASE_PENALTY = 0.15;
const EASY_EASE_BONUS = 0.15;
const HARD_INTERVAL_MULTIPLIER = 1.2;
const EASY_INTERVAL_BONUS_MULTIPLIER = 1.3;

interface Delta {
  state: CardState;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  learningStep: number;
}

/**
 * Plan §3.5: SM-2 scheduling, pure function, no I/O.
 *
 * The multiplication base for a graduated card is `max(elapsedDays, intervalDays)`, not bare
 * elapsed days: the plan's own example ("a card answered GOOD 30 days late schedules from 30, not
 * from its stale interval") only constrains the overdue case. Using `max` satisfies that case
 * while leaving early reviews (elapsed < scheduled) growing from the still-valid scheduled
 * interval instead of shrinking it.
 *
 * HARD's behaviour while a card is still in its learning/relearning steps is not specified by the
 * plan text (only GOOD's step-advance and EASY's new-card jump are). This implementation repeats
 * the current learning step (same due offset, ease still penalised) rather than advancing --
 * an implementer's judgment call, flagged here rather than left silent.
 */
export function schedule(card: SchedulingCard, rating: Rating, now: Date): ScheduleResult {
  const elapsedDays = daysSince(card.lastReviewedAt, now);
  const scheduledDays = card.intervalDays;

  const delta =
    rating === "AGAIN"
      ? deltaForAgain(card)
      : isLearningPhase(card.state)
        ? deltaForLearningPhase(card, rating)
        : deltaForReviewPhase(card, rating, Math.max(elapsedDays, card.intervalDays));

  return {
    ...delta,
    dueAt: addDays(now, delta.intervalDays),
    elapsedDays,
    scheduledDays,
  };
}

function isLearningPhase(state: CardState): boolean {
  return state === "NEW" || state === "LEARNING" || state === "RELEARNING";
}

function deltaForAgain(card: SchedulingCard): Delta {
  return {
    state: "RELEARNING",
    intervalDays: LEARNING_STEPS_DAYS[0] ?? 0,
    easeFactor: clampEase(card.easeFactor - AGAIN_EASE_PENALTY),
    repetitions: card.repetitions,
    lapses: card.lapses + 1,
    learningStep: 0,
  };
}

function deltaForLearningPhase(card: SchedulingCard, rating: Exclude<Rating, "AGAIN">): Delta {
  if (rating === "EASY") {
    // Plan §3.5: "EASY on a new card jumps straight to a 4-day interval".
    return {
      state: "REVIEW",
      intervalDays: EASY_NEW_CARD_INTERVAL_DAYS,
      easeFactor: clampEase(card.easeFactor + EASY_EASE_BONUS),
      repetitions: card.repetitions + 1,
      lapses: card.lapses,
      learningStep: 0,
    };
  }

  if (rating === "HARD") {
    return {
      state: card.state === "NEW" ? "LEARNING" : card.state,
      intervalDays: learningStepDays(card.learningStep),
      easeFactor: clampEase(card.easeFactor - HARD_EASE_PENALTY),
      repetitions: card.repetitions,
      lapses: card.lapses,
      learningStep: card.learningStep,
    };
  }

  // GOOD: advance to the next learning step, or graduate off the last one.
  const nextStep = card.learningStep + 1;
  if (nextStep < LEARNING_STEPS_DAYS.length) {
    return {
      state: card.state === "NEW" ? "LEARNING" : card.state,
      intervalDays: learningStepDays(nextStep),
      easeFactor: card.easeFactor,
      repetitions: card.repetitions,
      lapses: card.lapses,
      learningStep: nextStep,
    };
  }
  return {
    state: "REVIEW",
    intervalDays: GRADUATING_INTERVAL_DAYS,
    easeFactor: card.easeFactor,
    repetitions: card.repetitions + 1,
    lapses: card.lapses,
    learningStep: 0,
  };
}

function deltaForReviewPhase(card: SchedulingCard, rating: Exclude<Rating, "AGAIN">, base: number): Delta {
  if (rating === "HARD") {
    return {
      state: "REVIEW",
      intervalDays: clampInterval(base * HARD_INTERVAL_MULTIPLIER),
      easeFactor: clampEase(card.easeFactor - HARD_EASE_PENALTY),
      repetitions: card.repetitions,
      lapses: card.lapses,
      learningStep: 0,
    };
  }
  if (rating === "GOOD") {
    return {
      state: "REVIEW",
      intervalDays: clampInterval(base * card.easeFactor),
      easeFactor: card.easeFactor,
      repetitions: card.repetitions + 1,
      lapses: card.lapses,
      learningStep: 0,
    };
  }
  // EASY
  return {
    state: "REVIEW",
    intervalDays: clampInterval(base * card.easeFactor * EASY_INTERVAL_BONUS_MULTIPLIER),
    easeFactor: clampEase(card.easeFactor + EASY_EASE_BONUS),
    repetitions: card.repetitions + 1,
    lapses: card.lapses,
    learningStep: 0,
  };
}

function learningStepDays(step: number): number {
  return LEARNING_STEPS_DAYS[step] ?? LEARNING_STEPS_DAYS[LEARNING_STEPS_DAYS.length - 1] ?? 0;
}

function clampEase(ease: number): number {
  return Math.min(MAX_EASE, Math.max(MIN_EASE, ease));
}

function clampInterval(days: number): number {
  return Math.min(MAX_INTERVAL_DAYS, days);
}

function daysSince(date: Date | null, now: Date): number {
  if (date === null) {
    return 0;
  }
  return Math.max(0, (now.getTime() - date.getTime()) / DAY_MS);
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}
