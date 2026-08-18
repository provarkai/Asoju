import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { ServiceType } from '@prisma/client';

/**
 * docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 3, resolved decision #1 —
 * progressive enrichment of the same ServiceRequest a Concierge
 * conversation started (this is `StructuredRequest`, not a separate
 * model). Every field optional, same "fill in more as you go" shape as
 * ArrivalProfile's upsert — a call that only sets `timing` leaves
 * everything else untouched. Only reachable before the request converts
 * (CasesService.updateServiceRequest enforces that) — once a real Case
 * exists, this record is history, not a draft.
 */
export class UpdateServiceRequestDto {
  @IsOptional()
  @IsEnum(ServiceType)
  serviceType?: ServiceType;

  @IsOptional()
  @IsString()
  objective?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  timing?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsObject()
  requirements?: Record<string, unknown>;
}
