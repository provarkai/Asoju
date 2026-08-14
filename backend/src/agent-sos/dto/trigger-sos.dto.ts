import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { SOS_ALERT_TYPES, SOS_SEVERITY_LEVELS } from '../agent-sos.service';

export class TriggerSosDto {
  @IsIn(Object.values(SOS_ALERT_TYPES))
  alertType: string;

  @IsIn(Object.values(SOS_SEVERITY_LEVELS))
  severity: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsOptional()
  @IsNumber()
  accuracy?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  caseId?: string;

  @IsOptional()
  @IsString()
  assignmentId?: string;
}
