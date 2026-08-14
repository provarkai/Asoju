// ═══════════════════════════════════════════════════════════════════════════════
// Voice + Auto-Translation (Yoruba/Hausa/Igbo -> English)
// ═══════════════════════════════════════════════════════════════════════════════
// Ported from FieldForce's voice-translation.ts. Real provider: OpenAI's
// Whisper API (api.openai.com/v1/audio/*) — a real, publicly documented
// endpoint, not a guessed-at vendor shape. Dry-run-safe without
// OPENAI_API_KEY configured, same convention as every other real
// integration in this repo (WhatsApp/Paystack/Anthropic/etc).
//
// Same caveat FieldForce's version is honest about: whisper-1's training
// language coverage is broad, but how well it performs specifically on
// Yoruba/Hausa/Igbo hasn't been benchmarked here. `languageHint` (ISO
// 639-1) lets a caller bias decoding toward a known source language,
// which measurably helps accuracy on lower-resource languages.

export const SUPPORTED_SOURCE_LANGUAGES = ['yo', 'ha', 'ig', 'en'] as const;
export type SupportedSourceLanguage = (typeof SUPPORTED_SOURCE_LANGUAGES)[number];

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const WHISPER_MODEL = 'whisper-1';

// Whisper's verbose_json response names languages in full English words
// ("yoruba", "english"), not ISO 639-1 — normalize to codes so the stored
// transcriptLang stays a consistent short code either way (whether it
// came from auto-detection or a caller-supplied hint).
const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
  yoruba: 'yo',
  hausa: 'ha',
  igbo: 'ig',
  english: 'en',
};

function normalizeLanguage(detected: string | undefined): string | null {
  if (!detected) return null;
  const lower = detected.toLowerCase().trim();
  return LANGUAGE_NAME_TO_CODE[lower] ?? lower;
}

export function isVoiceTranslationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export interface TranscribeAndTranslateResult {
  transcript: string | null; // original-language transcript
  transcriptLang: string | null; // detected/hinted source language code
  translatedText: string | null; // English translation
  translatedLang: string | null; // 'en' once translation succeeds
  transcriptionStatus: 'COMPLETED' | 'FAILED';
  translationStatus: 'COMPLETED' | 'FAILED' | 'NOT_REQUESTED';
  dryRun: boolean;
}

/** Transcribes in the original language, then translates to English —
 * skipping the second call when the source already is English. Never
 * throws: every failure mode (unconfigured, network error, non-2xx)
 * comes back as a *_STATUS: 'FAILED' result so a bad voice note can't
 * take down the evidence submission that triggered it. */
export async function transcribeAndTranslate(
  audioBuffer: Buffer,
  fileName: string,
  mimeType: string,
  languageHint?: string,
): Promise<TranscribeAndTranslateResult> {
  if (!isVoiceTranslationConfigured()) {
    return {
      transcript: null,
      transcriptLang: null,
      translatedText: null,
      translatedLang: null,
      transcriptionStatus: 'FAILED',
      translationStatus: 'NOT_REQUESTED',
      dryRun: true,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY!;

  // 1. Transcribe in the original language. verbose_json surfaces the
  // detected language even when no hint was supplied.
  let transcript: string | null = null;
  let transcriptLang: string | null = languageHint ?? null;
  let transcriptionStatus: 'COMPLETED' | 'FAILED' = 'FAILED';

  try {
    const transcribeForm = new FormData();
    transcribeForm.append('file', new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), fileName);
    transcribeForm.append('model', WHISPER_MODEL);
    transcribeForm.append('response_format', 'verbose_json');
    if (languageHint) transcribeForm.append('language', languageHint);

    const res = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: transcribeForm,
    });

    if (res.ok) {
      const body = (await res.json()) as { text: string; language?: string };
      transcript = body.text;
      transcriptLang = languageHint ?? normalizeLanguage(body.language);
      transcriptionStatus = 'COMPLETED';
    }
  } catch {
    // Network/parse failure — transcriptionStatus stays FAILED below.
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
    };
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
    };
  }

  try {
    const translateForm = new FormData();
    translateForm.append('file', new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), fileName);
    translateForm.append('model', WHISPER_MODEL);

    const res = await fetch(`${OPENAI_API_BASE}/audio/translations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: translateForm,
    });

    if (res.ok) {
      const body = (await res.json()) as { text: string };
      return {
        transcript,
        transcriptLang,
        translatedText: body.text,
        translatedLang: 'en',
        transcriptionStatus: 'COMPLETED',
        translationStatus: 'COMPLETED',
        dryRun: false,
      };
    }
  } catch {
    // Network/parse failure — translationStatus stays FAILED below.
  }

  return {
    transcript,
    transcriptLang,
    translatedText: null,
    translatedLang: null,
    transcriptionStatus: 'COMPLETED',
    translationStatus: 'FAILED',
    dryRun: false,
  };
}
