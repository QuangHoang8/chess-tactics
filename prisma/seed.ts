import { createHash } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import {
  dedupeKeyOf,
  validateSolution,
  type Actor,
  type SolutionTreeInput,
  type ValidatedTreeNode,
} from "@chess-tactics/domain";

const prisma = new PrismaClient();

interface SeedLine {
  isPrimary: boolean;
  /** Alternating SOLVER, OPPONENT, SOLVER, ... starting with SOLVER. */
  sans: string[];
}

interface SeedPuzzle {
  key: string;
  fen: string;
  difficulty: number;
  themes: string[];
  tags: string[];
  source: string;
  explanation: string;
  lines: SeedLine[];
}

// The 4 puzzles verified by brute force in the planning spike (docs/implementation-plan.md §7).
// Re-verified here, for real, through the production validateSolution before insertion --
// nothing is trusted blindly from the plan document.
const SEED_PUZZLES: SeedPuzzle[] = [
  {
    key: "back-rank-mate",
    fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
    difficulty: 1,
    themes: ["backRankMate"],
    tags: ["mate-in-1"],
    source: "plan §7",
    explanation: "The rook delivers mate along the back rank; the king is boxed in by its own pawns.",
    lines: [{ isPrimary: true, sans: ["Ra8#"] }],
  },
  {
    key: "scholars-mate",
    fen: "r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 4",
    difficulty: 1,
    themes: ["scholarsMate"],
    tags: ["mate-in-1"],
    source: "plan §7",
    explanation: "The queen, supported by the bishop, captures f7 delivering checkmate.",
    lines: [{ isPrimary: true, sans: ["Qxf7#"] }],
  },
  {
    key: "smothered-mate",
    fen: "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1",
    difficulty: 2,
    themes: ["smotheredMate"],
    tags: ["mate-in-1"],
    source: "plan §7",
    explanation: "The knight delivers mate; the king cannot escape because its own pieces block every square.",
    lines: [{ isPrimary: true, sans: ["Nf7#"] }],
  },
  {
    key: "two-rook-ladder",
    fen: "7k/8/8/8/8/8/R7/1R5K w - - 0 1",
    difficulty: 2,
    themes: ["rookLadder"],
    tags: ["mate-in-2", "alternatives"],
    source: "plan §7",
    explanation: "A ladder mate: one rook checks to drive the king back while the other delivers mate.",
    lines: [
      { isPrimary: true, sans: ["Ra7", "Kg8", "Rb8#"] },
      { isPrimary: false, sans: ["Rb7", "Kg8", "Ra8#"] },
      { isPrimary: false, sans: ["Rg1", "Kh7", "Rh2#"] },
    ],
  },
];

function buildTree(lines: SeedLine[], depth: number): SolutionTreeInput[] {
  const actor: Actor = depth % 2 === 0 ? "SOLVER" : "OPPONENT";
  const groups = new Map<string, { isPrimary: boolean; rest: SeedLine[] }>();

  for (const line of lines) {
    const [first, ...restSans] = line.sans;
    if (first === undefined) {
      continue;
    }
    const subLine: SeedLine = { isPrimary: line.isPrimary, sans: restSans };
    const existing = groups.get(first);
    if (existing) {
      existing.rest.push(subLine);
    } else {
      groups.set(first, { isPrimary: line.isPrimary, rest: [subLine] });
    }
  }

  return [...groups.entries()].map(([san, group]) => ({
    san,
    actor,
    isPrimary: group.isPrimary,
    children: buildTree(
      group.rest.filter((line) => line.sans.length > 0),
      depth + 1,
    ),
  }));
}

/** Plan §4: dedupeHash is SHA-256 of the normalised FEN alone (board/turn/castling/en-passant, no clocks). */
function dedupeHashOf(fen: string): string {
  return createHash("sha256").update(dedupeKeyOf(fen)).digest("hex");
}

async function createMoveTree(
  puzzleId: string,
  parentId: string | null,
  nodes: ValidatedTreeNode[],
  ply: number,
): Promise<void> {
  for (const node of nodes) {
    const created = await prisma.puzzleMove.create({
      data: {
        puzzleId,
        parentId,
        ply,
        san: node.san,
        actor: node.actor,
        isPrimary: node.isPrimary,
        ...(node.comment !== undefined ? { comment: node.comment } : {}),
      },
    });
    await createMoveTree(puzzleId, created.id, node.children, ply + 1);
  }
}

async function seedBootstrapUser(): Promise<string> {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("SEED_USER_EMAIL and SEED_USER_PASSWORD must be set (see .env.example)");
  }

  const passwordHash = await hash(password);
  // update: the password is re-hashed and written on every run, so rotating SEED_USER_PASSWORD
  // and re-running the seed actually changes it -- an empty `update: {}` would silently keep
  // whatever password was set the first time the user row was created.
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  console.log(`Bootstrap user ready: ${email} (${user.id})`);
  return user.id;
}

async function seedPuzzles(userId: string): Promise<void> {
  for (const seed of SEED_PUZZLES) {
    const dedupeHash = dedupeHashOf(seed.fen);

    const existing = await prisma.puzzle.findUnique({
      where: { userId_dedupeHash: { userId, dedupeHash } },
    });
    if (existing) {
      console.log(`Skipping "${seed.key}" -- already seeded (${existing.id})`);
      continue;
    }

    const tree = buildTree(seed.lines, 0);
    const result = validateSolution(seed.fen, tree);
    if (!result.ok) {
      // Fail loudly rather than insert unsound puzzle content (plan §7's "honest limitation").
      throw new Error(
        `Seed "${seed.key}" failed validateSolution: ${JSON.stringify(result.errors, null, 2)}`,
      );
    }
    if (result.warnings.length > 0) {
      throw new Error(
        `Seed "${seed.key}" has unexpected warnings (hand-verified seeds should have none): ` +
          JSON.stringify(result.warnings, null, 2),
      );
    }

    const puzzle = await prisma.puzzle.create({
      data: {
        userId,
        fen: seed.fen,
        sideToMove: result.sideToMove,
        difficulty: seed.difficulty,
        source: seed.source,
        explanation: seed.explanation,
        themes: seed.themes,
        tags: seed.tags,
        dedupeHash,
      },
    });

    await createMoveTree(puzzle.id, null, result.tree, 1);

    await prisma.puzzleCard.create({
      data: { userId, puzzleId: puzzle.id, dueAt: new Date() },
    });

    console.log(`Seeded "${seed.key}" (${puzzle.id})`);
  }
}

async function main(): Promise<void> {
  const userId = await seedBootstrapUser();
  await seedPuzzles(userId);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
