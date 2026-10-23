import { useState } from "react";
import {
  Chessboard,
  ChessboardProvider,
  SparePiece,
  type PieceDropHandlerArgs,
  type PositionDataType,
} from "react-chessboard";
import { validateFen } from "@chess-tactics/domain";
import { EMPTY_BOARD_FEN, SPARE_PIECE_TYPES, buildFen, parseFenToPosition } from "../lib/chess-ui";

interface PositionEditorProps {
  initialFen: string;
  locked: boolean;
  onConfirm: (fen: string) => void;
  onUnlock: () => void;
}

export function PositionEditor({ initialFen, locked, onConfirm, onUnlock }: PositionEditorProps) {
  const seeded = parseFenToPosition(initialFen || EMPTY_BOARD_FEN);
  const [position, setPosition] = useState<PositionDataType>(seeded.position);
  const [sideToMove, setSideToMove] = useState<"w" | "b">(seeded.sideToMove);
  const [pasteDraft, setPasteDraft] = useState(initialFen || EMPTY_BOARD_FEN);
  const [pasteError, setPasteError] = useState<string | null>(null);

  const currentFen = buildFen(position, sideToMove);
  const validity = validateFen(currentFen);

  function handleDrop({ piece, sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    setPosition((prev) => {
      const next = { ...prev };
      if (!piece.isSparePiece) {
        delete next[sourceSquare];
      }
      if (targetSquare !== null) {
        next[targetSquare] = { pieceType: piece.pieceType };
      }
      return next;
    });
    return true;
  }

  function handleLoadFen(): void {
    const check = validateFen(pasteDraft);
    if (!check.ok) {
      setPasteError(check.error ?? "Invalid FEN");
      return;
    }
    setPasteError(null);
    const parsed = parseFenToPosition(pasteDraft);
    setPosition(parsed.position);
    setSideToMove(parsed.sideToMove);
  }

  if (locked) {
    return (
      <section className="position-editor position-editor-locked">
        <p>
          Starting position: <code>{initialFen}</code>
        </p>
        <button type="button" onClick={onUnlock}>
          Edit starting position (clears the solution so far)
        </button>
      </section>
    );
  }

  return (
    <section className="position-editor">
      <div className="position-editor-paste">
        <label>
          Paste FEN
          <input
            type="text"
            value={pasteDraft}
            onChange={(event) => setPasteDraft(event.target.value)}
            placeholder="e.g. 6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"
          />
        </label>
        <button type="button" onClick={handleLoadFen}>
          Load
        </button>
        {pasteError && <p role="alert">{pasteError}</p>}
      </div>

      <fieldset>
        <legend>Side to move</legend>
        <label>
          <input
            type="radio"
            name="sideToMove"
            checked={sideToMove === "w"}
            onChange={() => setSideToMove("w")}
          />
          White
        </label>
        <label>
          <input
            type="radio"
            name="sideToMove"
            checked={sideToMove === "b"}
            onChange={() => setSideToMove("b")}
          />
          Black
        </label>
      </fieldset>

      <ChessboardProvider options={{ position, onPieceDrop: handleDrop, allowDragOffBoard: true }}>
        <div className="spare-tray spare-tray-black">
          {SPARE_PIECE_TYPES.filter((p) => p.startsWith("b")).map((p) => (
            <SparePiece key={p} pieceType={p} />
          ))}
        </div>
        <div className="board-wrapper">
          <Chessboard />
        </div>
        <div className="spare-tray spare-tray-white">
          {SPARE_PIECE_TYPES.filter((p) => p.startsWith("w")).map((p) => (
            <SparePiece key={p} pieceType={p} />
          ))}
        </div>
      </ChessboardProvider>

      <p>
        Current FEN: <code>{currentFen}</code>
      </p>
      {!validity.ok && <p role="alert">{validity.error}</p>}

      <button type="button" disabled={!validity.ok} onClick={() => onConfirm(currentFen)}>
        Use this position
      </button>
    </section>
  );
}
