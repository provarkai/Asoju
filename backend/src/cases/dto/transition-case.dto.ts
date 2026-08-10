import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CaseStatus } from '@prisma/client';

export class TransitionCaseDto {
  @IsEnum(CaseStatus)
  toStatus: CaseStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}
