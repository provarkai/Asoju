import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { CasePriority, CaseTier, ServiceType } from '@prisma/client';

/**
 * Triage step (vertical slice 1: Request -> Case). A staff member (or a
 * validated AI tool-call at Action Level 2 — see Section 7.6) reviews a
 * ServiceRequest and converts it into a ServiceCase against one of the
 * three live MVP services (Section 6). This is a deterministic API call —
 * the LLM never writes a ServiceCase row directly.
 */
export class ConvertRequestDto {
  @IsEnum(ServiceType)
  serviceType: ServiceType;

  @IsString()
  @MinLength(5)
  description: string;

  @IsString()
  location: string;

  @IsOptional()
  @IsEnum(CasePriority)
  priority?: CasePriority;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  riskLevel?: number;

  @IsOptional()
  @IsEnum(CaseTier)
  tier?: CaseTier;

  // Section 5.1 P1 — link a saved beneficiary/property/asset so a repeat
  // customer never has to re-describe something ASOJU already knows about.
  // Ownership (must belong to the request's customer) is checked in the
  // service, not here — a DTO can't see the request being converted.
  @IsOptional()
  @IsString()
  beneficiaryId?: string;

  @IsOptional()
  @IsString()
  propertyId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;
}
