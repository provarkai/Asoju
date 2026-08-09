import { IsEnum, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { QcOutcome } from '@prisma/client';

/** Section 8.5 — QC outcomes: Approved / Rework / Escalate / Incident. */
export class PerformQcDto {
  @IsEnum(QcOutcome)
  outcome: QcOutcome;

  @IsOptional()
  @IsString()
  @MinLength(5)
  summary?: string;

  @IsOptional()
  @IsObject()
  findings?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  note?: string;
}
