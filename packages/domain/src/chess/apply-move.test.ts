import { describe, expect, it } from "vitest";
import { applyMove, applySan } from "./apply-move";

describe("applyMove", () => {
  it("converts board input to normalised SAN", () => {
    const result = applyMove("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", { from: "a1", to: "a8" });
    expect(result).toEqual({ ok: true, san: "Ra8#", fen: "R5k1/5ppp/8/8/8/8/8/6K1 b - - 1 1" });
  });

  it("errors when promotion is required but omitted -- not a silent queen", () => {
    const result = applyMove("8/P7/8/8/8/8/8/k6K w - - 0 1", { from: "a7", to: "a8" });
    expect(result.ok).toBe(false);
  });

  it("applies a promotion when specified", () => {
    const result = applyMove("8/P7/8/8/8/8/8/k6K w - - 0 1", { from: "a7", to: "a8", promotion: "n" });
    expect(result).toEqual({ ok: true, san: "a8=N", fen: "N7/8/8/8/8/8/8/k6K b - - 0 1" });
  });

  it("handles castling", () => {
    const result = applyMove("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", { from: "e1", to: "g1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.san).toBe("O-O");
    }
  });

  it("rejects an illegal move instead of throwing", () => {
    const result = applyMove("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", { from: "a1", to: "h8" });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed FEN", () => {
    const result = applyMove("not-a-fen", { from: "a1", to: "a8" });
    expect(result.ok).toBe(false);
  });
});

describe("applySan", () => {
  it("applies a stored SAN move and returns the resulting FEN", () => {
    const result = applySan("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "Ra8#");
    expect(result).toEqual({ ok: true, fen: "R5k1/5ppp/8/8/8/8/8/6K1 b - - 1 1" });
  });

  it("rejects an illegal SAN", () => {
    const result = applySan("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "Qxf7#");
    expect(result.ok).toBe(false);
  });
});
