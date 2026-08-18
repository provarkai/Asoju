import { IsEnum, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { ServiceType } from '@prisma/client';

/**
 * Raw inbound request (pre-case), per Section 7.2 message 2 — the customer's
 * ask in their own words. `serviceType` is optional/nullable here because
 * classifying it is the AI Concierge's job (Section 7.5
 * data_collected.service_type); a human/AI populates it before conversion —
 * previously true only in comment form (nothing ever actually set this
 * field after creation), now real: this DTO accepts it directly, and
 * PATCH /service-requests/:id (docs/AUTOMATION_PRICING_ENGINE_SCOPE.md
 * Phase 3) lets it (and the other structured-detail fields) be filled in
 * progressively afterwards.
 */
export class CreateServiceRequestDto {
  @IsString()
  @MinLength(5)
  rawDescription: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsIn(['whatsapp', 'web', 'email'])
  channel: string;

  @IsOptional()
  @IsEnum(ServiceType)
  serviceType?: ServiceType;
}
