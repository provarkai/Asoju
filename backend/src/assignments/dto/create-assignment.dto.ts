import { IsDateString, IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';
import { AssignmentRole } from '@prisma/client';

/** Section 3 — Assignment links a case <-> agent/provider. */
export class CreateAssignmentDto {
  @IsEnum(AssignmentRole)
  role: AssignmentRole;

  @ValidateIf((dto: CreateAssignmentDto) => dto.role === AssignmentRole.FIELD_AGENT)
  @IsString()
  agentId?: string;

  @ValidateIf((dto: CreateAssignmentDto) => dto.role === AssignmentRole.PROVIDER)
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}
