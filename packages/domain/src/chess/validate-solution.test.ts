import { describe, expect, it } from "vitest";
import { validateSolution } from "./validate-solution";
import type { SolutionTreeInput } from "./types";

function leaf(san: string, actor: SolutionTreeInput["actor"] = "SOLVER", isPrimary = true): SolutionTreeInput {
  return { san, actor, isPrimary, children: [] };
}

const BACK_RANK_MATE_FEN = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
const SCHOLARS_MATE_FEN = "r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 4";

describe("validateSolution", () => {
  it("rejects a malformed FEN", () => {
    const result = validateSolution("not-a-fen", [leaf("Ra8#")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message).toContain("Invalid FEN");
    }
  });

  it("rejects a FEN with no white king", () => {
    const result = validateSolution("6k1/5ppp/8/8/8/8/8/R7 w - - 0 1", [leaf("Ra8#")]);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty solution line (the §3.4 naive-validator gap)", () => {
    const result = validateSolution(BACK_RANK_MATE_FEN, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message).toContain("At least one SOLVER move");
    }
  });

  it("rejects a SAN that is illegal in the position", () => {
    const result = validateSolution(BACK_RANK_MATE_FEN, [leaf("Qxf7#")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.input).toBe("Qxf7#");
      expect(result.errors[0]?.message).toContain("Invalid move");
    }
  });

  it("rejects a move made by the wrong side", () => {
    // Black has no legal "...Kxh7"-style move here; white is to move.
    const result = validateSolution(BACK_RANK_MATE_FEN, [leaf("Kg8")]);
    expect(result.ok).toBe(false);
  });

  it.each(["Qxf7", "Qxf7+", "Qxf7!!", "Qf3xf7"])(
    "accepts sloppy SAN %s and normalises it to Qxf7#",
    (sloppySan) => {
      const result = validateSolution(SCHOLARS_MATE_FEN, [leaf(sloppySan)]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.tree[0]?.san).toBe("Qxf7#");
      }
    },
  );

  it("rejects wrong-case SAN", () => {
    const result = validateSolution(SCHOLARS_MATE_FEN, [leaf("QxF7")]);
    expect(result.ok).toBe(false);
  });

  it("distinguishes checkmate from a drawn ending (insufficient material)", () => {
    // King+Knight vs King is already insufficient material; any legal move keeps it that way.
    const insufficientMaterialFen = "8/8/8/8/4k3/8/3N4/4K3 w - - 0 1";
    const result = validateSolution(insufficientMaterialFen, [leaf("Nb3")]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ type: "ends_in_draw" }),
      );
    }
  });

  it("does not warn when the solution actually ends in checkmate", () => {
    const result = validateSolution(BACK_RANK_MATE_FEN, [leaf("Ra8#")]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toHaveLength(0);
    }
  });

  it("fires a coverage warning when a configured opponent reply set omits a legal reply", () => {
    // After 1.Qa8+ black has exactly two legal replies: Kh7 and Kg7. Configure only Kh7.
    const fen = "7k/8/8/8/8/8/8/Q5K1 w - - 0 1";
    const tree: SolutionTreeInput[] = [
      {
        san: "Qa8+",
        actor: "SOLVER",
        isPrimary: true,
        children: [leaf("Kh7", "OPPONENT")],
      },
    ];
    const result = validateSolution(fen, tree);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ type: "uncovered_opponent_reply", missingReplies: ["Kg7"] }),
      );
    }
  });

  it("does not warn when every legal opponent reply is covered", () => {
    const fen = "7k/8/8/8/8/8/8/Q5K1 w - - 0 1";
    const tree: SolutionTreeInput[] = [
      {
        san: "Qa8+",
        actor: "SOLVER",
        isPrimary: true,
        children: [leaf("Kh7", "OPPONENT"), leaf("Kg7", "OPPONENT")],
      },
    ];
    const result = validateSolution(fen, tree);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toHaveLength(0);
    }
  });

  it("validates a multi-ply tree with alternative solver lines (two-rook-ladder shape)", () => {
    const fen = "7k/8/8/8/8/8/R7/1R5K w - - 0 1";
    const tree: SolutionTreeInput[] = [
      {
        san: "Ra7",
        actor: "SOLVER",
        isPrimary: true,
        children: [
          {
            san: "Kg8",
            actor: "OPPONENT",
            isPrimary: true,
            children: [leaf("Rb8#")],
          },
        ],
      },
      {
        san: "Rb7",
        actor: "SOLVER",
        isPrimary: false,
        children: [
          {
            san: "Kg8",
            actor: "OPPONENT",
            isPrimary: true,
            children: [leaf("Ra8#")],
          },
        ],
      },
    ];
    const result = validateSolution(fen, tree);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tree).toHaveLength(2);
      expect(result.tree[0]?.children[0]?.children[0]?.san).toBe("Rb8#");
      expect(result.tree[1]?.children[0]?.children[0]?.san).toBe("Ra8#");
      expect(result.warnings).toHaveLength(0);
    }
  });

  it("rejects a non-SOLVER move at the root", () => {
    const result = validateSolution(BACK_RANK_MATE_FEN, [leaf("Ra8#", "OPPONENT")]);
    expect(result.ok).toBe(false);
  });
});
