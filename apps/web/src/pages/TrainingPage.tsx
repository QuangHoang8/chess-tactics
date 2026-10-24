import { useEffect, useRef, useState } from "react";
import { Chessboard, type PieceDropHandlerArgs } from "react-chessboard";
import type { MoveInput, RatingValue, TrainingSkipResponse } from "@chess-tactics/contracts";
import {
  ApiError,
  trainingAttempt,
  trainingHint,
  trainingNext,
  trainingReview,
  trainingSkip,
} from "../api/client";
import { PromotionPicker } from "../components/PromotionPicker";

type Status = "loading" | "ready" | "empty" | "error";

interface PendingPromotion {
  from: string;
  to: string;
}

const WAKING_THRESHOLD_MS = 1500;
const RATINGS: RatingValue[] = ["AGAIN", "HARD", "GOOD", "EASY"];

export function TrainingPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [waking, setWaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [puzzleId, setPuzzleId] = useState<string | null>(null);
  const [boardOrientation, setBoardOrientation] = useState<"white" | "black">("white");
  const [position, setPosition] = useState<string>("start");
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [skipReveal, setSkipReveal] = useState<TrainingSkipResponse | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [nextHintLevel, setNextHintLevel] = useState<1 | 2 | 3>(1);
  const [hintExhausted, setHintExhausted] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [puzzleStartedAt, setPuzzleStartedAt] = useState(() => Date.now());
  const [submittingReview, setSubmittingReview] = useState(false);
  const unmountedRef = useRef(false);

  function resetPerPuzzleState(): void {
    setPendingPromotion(null);
    setFeedback(null);
    setSolved(false);
    setExplanation(null);
    setSkipReveal(null);
    setHintText(null);
    setNextHintLevel(1);
    setHintExhausted(false);
    setHintsUsed(0);
    setPuzzleStartedAt(Date.now());
  }

  function loadNext(): void {
    setStatus("loading");
    const wakingTimer = setTimeout(() => {
      if (!unmountedRef.current) {
        setWaking(true);
      }
    }, WAKING_THRESHOLD_MS);

    trainingNext()
      .then((result) => {
        if (unmountedRef.current) {
          return;
        }
        if (!result) {
          setStatus("empty");
          return;
        }
        resetPerPuzzleState();
        setSessionId(result.sessionId);
        setPuzzleId(result.puzzleId);
        setBoardOrientation(result.boardOrientation);
        setPosition(result.fen);
        setSolved(result.solved);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (unmountedRef.current) {
          return;
        }
        setErrorMessage(error instanceof ApiError ? error.message : "Failed to load the next puzzle");
        setStatus("error");
      })
      .finally(() => {
        clearTimeout(wakingTimer);
        if (!unmountedRef.current) {
          setWaking(false);
        }
      });
  }

  useEffect(() => {
    loadNext();
    return () => {
      unmountedRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitMove(move: MoveInput, previousPosition: string): Promise<void> {
    if (!sessionId || !puzzleId) {
      return;
    }
    try {
      const result = await trainingAttempt({ sessionId, puzzleId, move });
      if (!result || !result.accepted) {
        setPosition(previousPosition);
        setFeedback("Not the solution -- try again.");
        return;
      }

      setFeedback(null);
      if (result.solved) {
        setPosition(result.fen ?? previousPosition);
        setSolved(true);
        setExplanation(result.explanation ?? null);
        return;
      }
      setPosition(result.opponentReply?.fen ?? result.fen ?? previousPosition);
    } catch (error) {
      setPosition(previousPosition);
      setFeedback(error instanceof ApiError ? error.message : "Something went wrong submitting that move.");
    }
  }

  function handlePieceDrop({ piece, sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare || solved) {
      return false;
    }

    const isPromotion =
      piece.pieceType.endsWith("P") && (targetSquare.endsWith("8") || targetSquare.endsWith("1"));
    if (isPromotion) {
      // Wait for the picker before submitting anything (v5 has no built-in promotion UI).
      setPendingPromotion({ from: sourceSquare, to: targetSquare });
      return false;
    }

    const previousPosition = position;
    void submitMove({ from: sourceSquare, to: targetSquare }, previousPosition);
    // Optimistic: the piece moves immediately: submitMove reverts `position` if the
    // server-validated solution tree rejects it (plan §1.6).
    return true;
  }

  function handlePromotionSelect(promotion: "q" | "r" | "b" | "n"): void {
    if (!pendingPromotion) {
      return;
    }
    const { from, to } = pendingPromotion;
    setPendingPromotion(null);
    void submitMove({ from, to, promotion }, position);
  }

  async function handleHint(): Promise<void> {
    if (!sessionId || !puzzleId || solved || hintExhausted) {
      return;
    }
    try {
      const result = await trainingHint({ sessionId, puzzleId, level: nextHintLevel });
      if (!result) {
        return;
      }
      setHintText(result.text);
      setHintsUsed((count) => count + 1);
      if (nextHintLevel < 3) {
        setNextHintLevel((nextHintLevel + 1) as 1 | 2 | 3);
      } else {
        setHintExhausted(true);
      }
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : "Could not fetch a hint.");
    }
  }

  async function handleSkip(): Promise<void> {
    if (!sessionId || !puzzleId || solved) {
      return;
    }
    try {
      const result = await trainingSkip({ sessionId, puzzleId });
      if (!result) {
        return;
      }
      setSkipReveal(result);
      setSolved(true);
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : "Could not skip this puzzle.");
    }
  }

  async function handleRate(rating: RatingValue): Promise<void> {
    if (!sessionId || !puzzleId || submittingReview) {
      return;
    }
    setSubmittingReview(true);
    try {
      await trainingReview({
        sessionId,
        puzzleId,
        rating,
        hintsUsed,
        durationMs: Date.now() - puzzleStartedAt,
      });
      loadNext();
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : "Could not submit that review.");
    } finally {
      setSubmittingReview(false);
    }
  }

  if (status === "loading") {
    return (
      <main className="training-page">
        <p>{waking ? "Waking the server... this can take about a minute." : "Loading..."}</p>
      </main>
    );
  }
  if (status === "empty") {
    return (
      <main className="training-page">
        <p>No puzzles due right now. Come back later.</p>
      </main>
    );
  }
  if (status === "error") {
    return (
      <main className="training-page">
        <p role="alert">{errorMessage}</p>
      </main>
    );
  }

  return (
    <main className="training-page">
      <h1>Chess Tactics Trainer</h1>
      <div className="board-wrapper">
        <Chessboard
          options={{
            position,
            boardOrientation,
            onPieceDrop: handlePieceDrop,
            allowDragging: !solved,
          }}
        />
      </div>
      {feedback && <p>{feedback}</p>}
      {pendingPromotion && (
        <PromotionPicker onSelect={handlePromotionSelect} onCancel={() => setPendingPromotion(null)} />
      )}

      {!solved && (
        <div className="training-controls">
          <button type="button" onClick={() => void handleHint()} disabled={hintExhausted}>
            Hint ({nextHintLevel}/3)
          </button>
          <button type="button" onClick={() => void handleSkip()}>
            Skip
          </button>
        </div>
      )}
      {hintText && !solved && <p>{hintText}</p>}

      {solved && (
        <div className="training-review">
          {skipReveal ? (
            <>
              <p>Solution: {skipReveal.solutionLine.join(" ")}</p>
              {skipReveal.explanation && <p>{skipReveal.explanation}</p>}
            </>
          ) : (
            <>
              <p>Solved!</p>
              {explanation && <p>{explanation}</p>}
            </>
          )}
          <p>How did that go?</p>
          <div className="training-ratings">
            {RATINGS.map((rating) => (
              <button
                key={rating}
                type="button"
                disabled={submittingReview}
                onClick={() => void handleRate(rating)}
              >
                {rating}
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
