import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ServiceType } from '@prisma/client';

export class CreateAutomationCapabilityDto {
  @IsEnum(ServiceType)
  serviceType: ServiceType;

  // Defaults to false server-side — the kill switch must be deliberately
  // turned on, never on by the mere existence of a row.
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
