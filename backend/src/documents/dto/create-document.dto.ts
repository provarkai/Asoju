import { DocumentVisibility } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

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

  /** Security hardening — least-privilege document visibility (see
   * Document.visibility). Defaults to ALL (every assignee sees it) if
   * omitted, preserving prior behaviour. */
  @IsOptional()
  @IsEnum(DocumentVisibility)
  visibility?: DocumentVisibility;

  /** Required when visibility is ASSIGNEE — the one Assignment on this
   * case whose holder may see the document. */
  @IsOptional()
  @IsString()
  restrictedToAssignmentId?: string;
}
