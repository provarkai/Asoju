import { IsEnum, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { EvidenceLevel, EvidenceType } from '@prisma/client';

/**
 * Section 8.4 — evidence object. `storageKey` is a private object-storage
 * reference obtained from a separate signed-upload step (Section 11.2:
 * "secure private object storage, never predictable public URLs") — the
 * actual file bytes never pass through this API.
 */
export class CreateEvidenceDto {
  @IsEnum(EvidenceType)
  type: EvidenceType;

  @IsOptional()
  @IsEnum(EvidenceLevel)
  evidenceLevel?: EvidenceLevel;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsOptional()
  @IsObject()
  locationMetadata?: Record<string, unknown>;

  @IsString()
  @MinLength(1)
  storageKey: string;

  /** Offline-queue hardening — see Evidence.clientRequestId. Optional so
   * existing/manual callers keep working unchanged. */
  @IsOptional()
  @IsString()
  clientRequestId?: string;

  /** #42 — only meaningful for type VOICE. ISO 639-1 hint (yo/ha/ig/en)
   * that measurably improves Whisper's transcription accuracy on
   * lower-resource languages when the agent's language is already known.
   * Harmless to send for other evidence types; simply ignored. */
  @IsOptional()
  @IsString()
  languageHint?: string;
}
