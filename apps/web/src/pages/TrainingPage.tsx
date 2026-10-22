import { useEffect, useState } from "react";
import { Chessboard, type PieceDropHandlerArgs } from "react-chessboard";
import type { MoveInput } from "@chess-tactics/contracts";
import { ApiError, trainingAttempt, trainingNext } from "../api/client";
import { PromotionPicker } from "../components/PromotionPicker";

type Status = "loading" | "ready" | "empty" | "error";

interface PendingPromotion {
  from: string;
  to: string;
}

const WAKING_THRESHOLD_MS = 1500;

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

  useEffect(() => {
    let cancelled = false;
    const wakingTimer = setTimeout(() => {
      if (!cancelled) {
        setWaking(true);
      }
    }, WAKING_THRESHOLD_MS);

    trainingNext()
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result) {
          setStatus("empty");
          return;
        }
        setSessionId(result.sessionId);
        setPuzzleId(result.puzzleId);
        setBoardOrientation(result.boardOrientation);
        setPosition(result.fen);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(error instanceof ApiError ? error.message : "Failed to load the next puzzle");
        setStatus("error");
      })
      .finally(() => {
        clearTimeout(wakingTimer);
        if (!cancelled) {
          setWaking(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(wakingTimer);
    };
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
        setFeedback("Solved!");
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
    </main>
  );
}
