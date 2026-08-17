import { IsEnum, IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { VaultCategory } from '@prisma/client';

/** Section 4.1 — "My Nigeria" locker: a document the customer owns
 * independently of any single case. Same presign-then-verify upload
 * pattern as Document/Evidence (see StorageService) — storageKey only
 * ever comes from POST /me/vault-documents/upload-url, and the file part
 * is optional (a vault entry can be metadata-only, e.g. "I have a title
 * deed, ask me for it" with no scan uploaded yet). */
export class CreateVaultDocumentDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsEnum(VaultCategory)
  category?: VaultCategory;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  storageKey?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  fileSize?: number;
}
