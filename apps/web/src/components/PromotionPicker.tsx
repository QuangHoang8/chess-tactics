// react-chessboard v5 has no built-in promotion UI (plan §3.1), so this is hand-built.
type PromotionPiece = "q" | "r" | "b" | "n";

interface PromotionPickerProps {
  onSelect: (piece: PromotionPiece) => void;
  onCancel: () => void;
}

const PIECES: Array<{ value: PromotionPiece; label: string }> = [
  { value: "q", label: "Queen" },
  { value: "r", label: "Rook" },
  { value: "b", label: "Bishop" },
  { value: "n", label: "Knight" },
];

export function PromotionPicker({ onSelect, onCancel }: PromotionPickerProps) {
  return (
    <div className="promotion-picker-overlay" role="dialog" aria-label="Choose promotion piece">
      <div className="promotion-picker">
        {PIECES.map((piece) => (
          <button key={piece.value} type="button" onClick={() => onSelect(piece.value)}>
            {piece.label}
          </button>
        ))}
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
