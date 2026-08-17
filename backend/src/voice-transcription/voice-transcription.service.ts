import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { transcribeAndTranslate, isVoiceTranslationConfigured } from './voice-translation';

/** MIME type inferred from the evidence's storageKey extension — Evidence
 * doesn't carry a contentType column, only the key (which does keep the
 * uploaded file's extension, see StorageService.createKey). Falls back
 * to a generic audio type Whisper still accepts. */
function mimeTypeFromKey(key: string): string {
  const ext = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1).toLowerCase() : '';
  const known: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    webm: 'audio/webm',
    ogg: 'audio/ogg',
  };
  return known[ext] ?? 'audio/mpeg';
}

@Injectable()
export class VoiceTranscriptionService {
  private readonly logger = new Logger(VoiceTranscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  isConfigured(): boolean {
    return isVoiceTranslationConfigured();
  }

  /** Attempts to transcribe+translate a freshly-submitted VOICE evidence
   * item and writes the result back onto the Evidence row. Never throws —
   * a bad or unconfigured transcription can't take down the evidence
   * submission that triggered it (same "record what happened, don't
   * block on it" honesty as every other real integration in this repo).
   * Callers that don't care about the outcome can fire-and-forget this;
   * evidence.service.ts awaits it so e2e tests observe a deterministic
   * result rather than a race. */
  async transcribeEvidence(evidenceId: string): Promise<void> {
    const evidence = await this.prisma.evidence.findUnique({ where: { id: evidenceId } });
    if (!evidence || evidence.type !== 'VOICE') return;

    if (!this.isConfigured()) {
      this.logger.warn(`Voice transcription not configured (dry run) — evidence ${evidenceId} left as NOT_REQUESTED`);
      await this.prisma.evidence.update({
        where: { id: evidenceId },
        data: { transcriptionStatus: 'FAILED', translationStatus: 'NOT_REQUESTED' },
      });
      return;
    }

    const audioBuffer = await this.storage.getBuffer(evidence.storageKey);
    if (!audioBuffer) {
      this.logger.error(`Could not fetch audio bytes for evidence ${evidenceId} at ${evidence.storageKey}`);
      await this.prisma.evidence.update({
        where: { id: evidenceId },
        data: { transcriptionStatus: 'FAILED', translationStatus: 'NOT_REQUESTED' },
      });
      return;
    }

    const result = await transcribeAndTranslate(
      audioBuffer,
      evidence.storageKey,
      mimeTypeFromKey(evidence.storageKey),
      evidence.languageHint ?? undefined,
    );

    await this.prisma.evidence.update({
      where: { id: evidenceId },
      data: {
        transcript: result.transcript,
        transcriptLang: result.transcriptLang,
        translatedText: result.translatedText,
        translatedLang: result.translatedLang,
        transcriptionStatus: result.transcriptionStatus,
        translationStatus: result.translationStatus,
      },
    });
  }
}
