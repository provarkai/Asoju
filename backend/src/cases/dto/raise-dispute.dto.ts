import { ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';

/** Section 3.1 — customer-initiated rejection of a delivered report.
 * Distinct from ApprovalActionDto's REQUEST_ADDITIONAL_WORK (a lighter
 * "please add X" ask that stays in CUSTOMER_REVIEW/ADDITIONAL_WORK): a
 * dispute is a structured, tracked rejection — specific disputed items,
 * its own Dispute record, and a case status (DISPUTED) the team has to
 * explicitly resolve. */
export class RaiseDisputeDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one disputed item' })
  @IsString({ each: true })
  reasons: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}
