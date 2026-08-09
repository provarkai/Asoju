import { IsString, MinLength } from 'class-validator';

/**
 * Section 12 P1 — "document vault". Like Evidence, `storageKey` is a
 * private object-storage reference from a separate signed-upload step —
 * the file bytes never pass through this API (Section 11.2).
 */
export class CreateDocumentDto {
  @IsString()
  @MinLength(2)
  label: string;

  @IsString()
  @MinLength(1)
  storageKey: string;
}
