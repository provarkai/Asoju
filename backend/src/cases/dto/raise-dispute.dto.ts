import { ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';

/** Section 3.1 — customer-initiated rejection of a delivered report.
 * Distinct from ApprovalActionDto's REQUEST_ADDITIONAL_WORK (a lighter
 * "please add X" ask that stays in CUSTOMER_REVIEW/ADDITIONAL_WORK): a
 * dispute is a structured, tracked rejection — specific disputed items,
 * its own Dispute record, and a case status (DISPUTED) the team has to
 * explicitly resolve.
 *
 * `disputedTaskIds` is the structured gap form (Platform Expansion PRD
 * §3.1): the customer must point at specific CaseTask checklist items,
 * not just describe the problem in prose. CasesService.raiseDispute
 * validates every id actually belongs to this case before accepting it,
 * and reopens exactly those tasks as the rework scope. `reasons`/`notes`
 * stay as free-text context alongside the structured items, not a
 * substitute for them. */
export class RaiseDisputeDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one disputed checklist item' })
  @IsString({ each: true })
  disputedTaskIds: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reasons?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}
