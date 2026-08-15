// ═══════════════════════════════════════════════════════════════════════════════
// MOAT BUILDER — Voice Notes in Chat: orchestration layer
// ═══════════════════════════════════════════════════════════════════════════════
// The VoiceNote Prisma model (schema.prisma) was already fully scaffolded;
// this is what actually populates it. messageId/threadId are intentionally
// plain strings, not Prisma relations — per the model's own comment, the
// chat thread/message live in the separate chat-service's own SQLite DB,
// same Integration-Gateway-style decoupling as the rest of the ASOJU<->
// FieldForce boundary, not a shared-DB foreign key.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db'
import {
  transcribeAndTranslate,
  type SupportedSourceLanguage,
} from '@/lib/voice-translation'

const MAX_VOICE_NOTE_BYTES = 15 * 1024 * 1024 // 15 MB — a few minutes of compressed voice audio
const ALLOWED_VOICE_MIME_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
])

export interface VoiceNoteValidationResult {
  valid: boolean
  error?: string
}

export function validateVoiceNoteMedia(mimeType: string, size: number): VoiceNoteValidationResult {
  if (!ALLOWED_VOICE_MIME_TYPES.has(mimeType)) {
    return { valid: false, error: `Unsupported audio type: ${mimeType}` }
  }
  if (size > MAX_VOICE_NOTE_BYTES) {
    return { valid: false, error: `Voice note too large: ${size} bytes (max: ${MAX_VOICE_NOTE_BYTES})` }
  }
  return { valid: true }
}

/** Server-assigned, deterministic — same shape as evidence-custody.ts's
 * generateStorageKey. Storage itself is a placeholder pending real S3/GCS
 * wiring, matching every other media path in this app today (evidence
 * intake computes hashes/metadata but doesn't persist bytes anywhere real
 * either — "storageProvider: 'LOCAL' // Will be S3/GCS in production"). */
function generateVoiceNoteStorageKey(threadId: string, voiceNoteId: string, fileName: string): string {
  const ext = fileName.split('.').pop() || 'webm'
  const timestamp = Date.now().toString(36)
  return `voice-notes/${threadId}/${voiceNoteId}/${timestamp}.${ext}`
}

export interface SubmitVoiceNoteInput {
  messageId: string
  threadId: string
  senderId: string
  senderRole: string
  audioBuffer: Buffer
  fileName: string
  mimeType: string
  durationSeconds: number
  languageHint?: SupportedSourceLanguage
}

export interface SubmitVoiceNoteResult {
  success: boolean
  error?: string
  voiceNote?: {
    id: string
    audioUrl: string
    transcript: string | null
    transcriptLang: string | null
    translatedText: string | null
    translatedLang: string | null
    transcriptionStatus: string
    translationStatus: string
    dryRun: boolean
  }
}

/** Creates the VoiceNote row and runs transcription+translation inline —
 * voice notes are short (a few minutes at most), so a synchronous round
 * trip is simpler than a queue/webhook and still returns in a few seconds.
 * A translation failure never fails the submission itself: the note is
 * still created and playable, just without a transcript — same
 * "never let a side-effect failure block the primary action" pattern as
 * evidence-custody.ts's QUARANTINED (not rejected) hash-mismatch path. */
export async function submitVoiceNote(input: SubmitVoiceNoteInput): Promise<SubmitVoiceNoteResult> {
  const validation = validateVoiceNoteMedia(input.mimeType, input.audioBuffer.length)
  if (!validation.valid) {
    return { success: false, error: validation.error }
  }

  const voiceNoteId = `vn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const audioUrl = generateVoiceNoteStorageKey(input.threadId, voiceNoteId, input.fileName)

  const result = await transcribeAndTranslate(
    input.audioBuffer,
    input.fileName,
    input.mimeType,
    input.languageHint,
  )

  const voiceNote = await db.voiceNote.create({
    data: {
      id: voiceNoteId,
      messageId: input.messageId,
      threadId: input.threadId,
      senderId: input.senderId,
      senderRole: input.senderRole,
      audioUrl,
      durationSeconds: input.durationSeconds,
      fileSize: input.audioBuffer.length,
      mimeType: input.mimeType,
      transcript: result.transcript ?? undefined,
      transcriptLang: result.transcriptLang ?? undefined,
      translatedText: result.translatedText ?? undefined,
      translatedLang: result.translatedLang ?? undefined,
      transcriptionStatus: result.dryRun ? 'PENDING' : result.transcriptionStatus,
      translationStatus: result.dryRun ? 'PENDING' : result.translationStatus,
    },
  })

  return {
    success: true,
    voiceNote: {
      id: voiceNote.id,
      audioUrl: voiceNote.audioUrl,
      transcript: voiceNote.transcript,
      transcriptLang: voiceNote.transcriptLang,
      translatedText: voiceNote.translatedText,
      translatedLang: voiceNote.translatedLang,
      transcriptionStatus: voiceNote.transcriptionStatus,
      translationStatus: voiceNote.translationStatus,
      dryRun: result.dryRun,
    },
  }
}

export async function getVoiceNote(id: string) {
  return db.voiceNote.findUnique({ where: { id } })
}

export async function listVoiceNotesForThread(threadId: string) {
  return db.voiceNote.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' } })
}
