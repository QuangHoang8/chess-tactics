-- AlterTable
ALTER TABLE "TrainingSession" ADD COLUMN     "currentNodeId" TEXT,
ADD COLUMN     "hadRejectedAttempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "skipped" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "solved" BOOLEAN NOT NULL DEFAULT false;

-- Close out every Phase-1-era orphan row. Phase 1's getNext() created a new TrainingSession per
-- call and never set endedAt on any of them, which was harmless while the column was write-only.
-- Starting with this migration, `endedAt IS NULL` means "resumable" (plan §4.6), so every existing
-- open row must be closed first or getNext() would latch onto a stale one and re-serve the same
-- puzzle forever.
UPDATE "TrainingSession" SET "endedAt" = now() WHERE "endedAt" IS NULL;
