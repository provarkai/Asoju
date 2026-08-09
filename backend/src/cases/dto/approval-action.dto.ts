import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApprovalAction } from '@prisma/client';

/** Section 5.1 — customer approval actions on the case detail page. */
export class ApprovalActionDto {
  @IsEnum(ApprovalAction)
  action: ApprovalAction;

  @IsOptional()
  @IsString()
  note?: string;
}
