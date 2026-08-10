import { IsEnum, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { QcOutcome } from '@prisma/client';

/** Section 8.5 / P0 Technical Build Spec Section 26 "QC Engine" — QC
 * outcomes: Approved / Pass with limitation / Rework / Revisit required /
 * Escalate / Incident. `summary` is required for APPROVED and
 * PASS_WITH_LIMITATION (both issue a report); `note` is required for
 * PASS_WITH_LIMITATION (the recorded limitation) and REVISIT_REQUIRED (what
 * the revisit needs to cover) — enforced in EvidenceService.performQc,
 * not here, since it's conditional on `outcome`. */
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
