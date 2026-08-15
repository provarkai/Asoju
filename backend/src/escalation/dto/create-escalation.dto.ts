import { IsEnum, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { EscalationReasonCategory } from '@prisma/client';

export class CreateEscalationDto {
  @IsEnum(EscalationReasonCategory)
  reasonCategory: EscalationReasonCategory;

  // Always required — an escalation with no approved customer-facing
  // explanation can't be created at all. Source spec §9: never expose
  // internal risk scores/thresholds/hidden rules instead.
  @IsString()
  @MinLength(1)
  customerMessage: string;

  @IsOptional()
  @IsString()
  internalReason?: string;

  @IsOptional()
  @IsObject()
  handoffSummary?: Record<string, unknown>;
}
