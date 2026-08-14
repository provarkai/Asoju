import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { VaultCategory } from '@prisma/client';

/** Section 4.2 — a reusable, staff-verified legal asset (e.g. Power of
 * Attorney). Submitted unverified; a staff member confirms it once via
 * VaultService.verifyAsset, after which future cases can reference it
 * instead of re-verifying the same document each time. */
export class CreateVerifiedAssetDto {
  @IsEnum(VaultCategory)
  type: VaultCategory;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
