import { IsOptional, IsString, MinLength } from 'class-validator';

/** Section 5.1 P1 — "multiple beneficiaries" (e.g. customer's parents/family being helped). */
export class CreateBeneficiaryDto {
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsOptional()
  @IsString()
  relationship?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
