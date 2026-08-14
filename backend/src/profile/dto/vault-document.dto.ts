import { IsOptional, IsString, MinLength } from 'class-validator';

/** Customer-level vault (VaultDocument) — same presign-then-verify upload
 * pattern as Documents/Evidence: storageKey only ever comes from a prior
 * createUploadUrl() call, checked in ProfileService.addVaultDocument. */
export class CreateVaultDocumentDto {
  @IsString()
  @MinLength(2)
  label: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsString()
  @MinLength(1)
  storageKey: string;
}
