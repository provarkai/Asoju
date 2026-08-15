-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "languageHint" TEXT,
ADD COLUMN     "transcript" TEXT,
ADD COLUMN     "transcriptLang" TEXT,
ADD COLUMN     "translatedText" TEXT,
ADD COLUMN     "translatedLang" TEXT,
ADD COLUMN     "transcriptionStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
ADD COLUMN     "translationStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED';
