// ═══════════════════════════════════════════════════════════════════════════════
// MOAT BUILDER — Voice + Auto-Translation (Yoruba/Hausa/Igbo → English)
// ═══════════════════════════════════════════════════════════════════════════════
// Implements the transcription/translation half of the already-scaffolded
// VoiceNote model (schema.prisma, "MOAT BUILDER — Voice Notes in Chat") — the
// model existed with the right fields but nothing in src/ ever populated them.
//
// Real provider: OpenAI's Whisper API (api.openai.com/v1/audio/*) — a real,
// publicly documented endpoint, not a guessed-at vendor shape (unlike
// WhatsappWebhookGuard's still-open Zavu signature gap, this one's request/
// response shape is fully confirmed from OpenAI's own docs). Dry-run-safe
// without OPENAI_API_KEY configured, same convention as every other real
// integration in this codebase (WhatsApp/Paystack/etc in the main ASOJU repo).
//
// Caveat worth being honest about, the same way ZAVU_INBOUND_SIGNATURE_OUTREACH.md
// is honest about what's confirmed vs not: whisper-1's *training* language
// coverage is broad, but how well it performs specifically on Yoruba/Hausa/Igbo
// hasn't been verified here — no low-resource-language benchmark was run
// against this integration. The `languageHint` param below (ISO 639-1) lets a
// caller bias decoding toward a known source language, which measurably helps
// accuracy on lower-resource languages — worth setting whenever an agent's
// language preference is known, rather than leaving auto-detect to guess.
// ═══════════════════════════════════════════════════════════════════════════════

export const SUPPORTED_SOURCE_LANGUAGES = ['yo', 'ha', 'ig', 'en'] as const
export type SupportedSourceLanguage = (typeof SUPPORTED_SOURCE_LANGUAGES)[number]

const OPENAI_API_BASE = 'https://api.openai.com/v1'
const WHISPER_MODEL = 'whisper-1'

// Whisper's verbose_json response names languages in full English words
// ("yoruba", "english"), not ISO 639-1 — normalize to codes so
// VoiceNote.transcriptLang stays a consistent short code either way
// (whether it came from this auto-detection or a caller-supplied hint).
const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
  yoruba: 'yo',
  hausa: 'ha',
  igbo: 'ig',
  english: 'en',
}

function normalizeLanguage(detected: string | undefined): string | null {
  if (!detected) return null
  const lower = detected.toLowerCase().trim()
  return LANGUAGE_NAME_TO_CODE[lower] ?? lower
}

export function isVoiceTranslationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}

export interface TranscribeAndTranslateResult {
  transcript: string | null // original-language transcript
  transcriptLang: string | null // detected/hinted source language code
  translatedText: string | null // English translation
  translatedLang: string | null // 'en' once translation succeeds
  transcriptionStatus: 'COMPLETED' | 'FAILED'
  translationStatus: 'COMPLETED' | 'FAILED' | 'NOT_REQUESTED'
  dryRun: boolean
}

/** Transcribes in the original language, then translates to English —
 * skipping the second call when the source already is English. Never
 * throws: every failure mode (unconfigured, network error, non-2xx) comes
 * back as a *_STATUS: 'FAILED' result so a bad voice note can't take down
 * the request that submitted it. */
export async function transcribeAndTranslate(
  audioBuffer: Buffer,
  fileName: string,
  mimeType: string,
  languageHint?: SupportedSourceLanguage,
): Promise<TranscribeAndTranslateResult> {
  if (!isVoiceTranslationConfigured()) {
    console.warn(
      `[voice-translation] not configured (dry run) — would have transcribed "${fileName}" (${mimeType})`
    )
    return {
      transcript: null,
      transcriptLang: null,
      translatedText: null,
      translatedLang: null,
      transcriptionStatus: 'FAILED',
      translationStatus: 'NOT_REQUESTED',
      dryRun: true,
    }
  }

  const apiKey = process.env.OPENAI_API_KEY!

  // 1. Transcribe in the original language. verbose_json surfaces the
  // detected language even when no hint was supplied.
  let transcript: string | null = null
  let transcriptLang: string | null = languageHint ?? null
  let transcriptionStatus: 'COMPLETED' | 'FAILED' = 'FAILED'

  try {
    const transcribeForm = new FormData()
    transcribeForm.append('file', new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), fileName)
    transcribeForm.append('model', WHISPER_MODEL)
    transcribeForm.append('response_format', 'verbose_json')
    if (languageHint) transcribeForm.append('language', languageHint)

    const res = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: transcribeForm,
    })

    if (res.ok) {
      const body = (await res.json()) as { text: string; language?: string }
      transcript = body.text
      transcriptLang = languageHint ?? normalizeLanguage(body.language)
      transcriptionStatus = 'COMPLETED'
    } else {
      const errorBody = await res.text().catch(() => '')
      console.error(`[voice-translation] transcription failed (${res.status}): ${errorBody.slice(0, 200)}`)
    }
  } catch (error) {
    console.error('[voice-translation] transcription request failed', error)
  }

  if (transcriptionStatus === 'FAILED') {
    return {
      transcript: null,
      transcriptLang,
      translatedText: null,
      translatedLang: null,
      transcriptionStatus: 'FAILED',
      translationStatus: 'NOT_REQUESTED',
      dryRun: false,
    }
  }

  // 2. Translate to English — Whisper's dedicated /translations endpoint
  // always outputs English regardless of source language, so this is a
  // second, independent request rather than a text-translation step on
  // the transcript above (more accurate for tonal languages than
  // translating already-transcribed text would be).
  if (transcriptLang === 'en') {
    return {
      transcript,
      transcriptLang,
      translatedText: transcript, // already English — the transcript IS the translation
      translatedLang: 'en',
      transcriptionStatus: 'COMPLETED',
      translationStatus: 'COMPLETED',
      dryRun: false,
    }
  }

  try {
    const translateForm = new FormData()
    translateForm.append('file', new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), fileName)
    translateForm.append('model', WHISPER_MODEL)

    const res = await fetch(`${OPENAI_API_BASE}/audio/translations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: translateForm,
    })

    if (res.ok) {
      const body = (await res.json()) as { text: string }
      return {
        transcript,
        transcriptLang,
        translatedText: body.text,
        translatedLang: 'en',
        transcriptionStatus: 'COMPLETED',
        translationStatus: 'COMPLETED',
        dryRun: false,
      }
    }
    const errorBody = await res.text().catch(() => '')
    console.error(`[voice-translation] translation failed (${res.status}): ${errorBody.slice(0, 200)}`)
  } catch (error) {
    console.error('[voice-translation] translation request failed', error)
  }

  return {
    transcript,
    transcriptLang,
    translatedText: null,
    translatedLang: null,
    transcriptionStatus: 'COMPLETED',
    translationStatus: 'FAILED',
    dryRun: false,
  }
}
