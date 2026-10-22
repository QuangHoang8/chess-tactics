-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Actor" AS ENUM ('SOLVER', 'OPPONENT');

-- CreateEnum
CREATE TYPE "CardState" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING');

-- CreateEnum
CREATE TYPE "Rating" AS ENUM ('AGAIN', 'HARD', 'GOOD', 'EASY');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('JSON', 'CSV', 'PGN');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PREVIEWED', 'COMMITTED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "dayRolloverHour" INTEGER NOT NULL DEFAULT 0,
    "newPerDay" INTEGER NOT NULL DEFAULT 20,
    "reviewsPerDay" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Puzzle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fen" TEXT NOT NULL,
    "sideToMove" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "source" TEXT,
    "explanation" TEXT,
    "themes" TEXT[],
    "tags" TEXT[],
    "dedupeHash" TEXT NOT NULL,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Puzzle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PuzzleMove" (
    "id" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "parentId" TEXT,
    "ply" INTEGER NOT NULL,
    "san" TEXT NOT NULL,
    "actor" "Actor" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL,
    "comment" TEXT,

    CONSTRAINT "PuzzleMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PuzzleCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "state" "CardState" NOT NULL DEFAULT 'NEW',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "intervalDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "learningStep" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" TIMESTAMP(3),

    CONSTRAINT "PuzzleCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "rating" "Rating" NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "hintsUsed" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "elapsedDays" DOUBLE PRECISION NOT NULL,
    "scheduledDays" DOUBLE PRECISION NOT NULL,
    "intervalBefore" DOUBLE PRECISION NOT NULL,
    "easeBefore" DOUBLE PRECISION NOT NULL,
    "repsBefore" INTEGER NOT NULL,
    "lapsesBefore" INTEGER NOT NULL,
    "stateBefore" "CardState" NOT NULL,

    CONSTRAINT "ReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceName" TEXT,
    "totalRows" INTEGER NOT NULL,
    "acceptedRows" INTEGER NOT NULL,
    "rejectedRows" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "newServed" INTEGER NOT NULL DEFAULT 0,
    "reviewsServed" INTEGER NOT NULL DEFAULT 0,
    "currentPuzzleId" TEXT,

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Puzzle_userId_createdAt_idx" ON "Puzzle"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Puzzle_userId_difficulty_idx" ON "Puzzle"("userId", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "Puzzle_userId_dedupeHash_key" ON "Puzzle"("userId", "dedupeHash");

-- CreateIndex
CREATE INDEX "PuzzleMove_puzzleId_parentId_idx" ON "PuzzleMove"("puzzleId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "PuzzleCard_puzzleId_key" ON "PuzzleCard"("puzzleId");

-- CreateIndex
CREATE INDEX "PuzzleCard_userId_dueAt_idx" ON "PuzzleCard"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "ReviewLog_userId_reviewedAt_idx" ON "ReviewLog"("userId", "reviewedAt");

-- CreateIndex
CREATE INDEX "ReviewLog_cardId_reviewedAt_idx" ON "ReviewLog"("cardId", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_userId_idempotencyKey_key" ON "ImportBatch"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Puzzle" ADD CONSTRAINT "Puzzle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Puzzle" ADD CONSTRAINT "Puzzle_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleMove" ADD CONSTRAINT "PuzzleMove_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleMove" ADD CONSTRAINT "PuzzleMove_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PuzzleMove"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleCard" ADD CONSTRAINT "PuzzleCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleCard" ADD CONSTRAINT "PuzzleCard_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PuzzleCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

