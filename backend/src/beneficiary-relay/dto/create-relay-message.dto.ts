import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { BeneficiaryRelayMessageType } from '@prisma/client';

/** Platform Expansion PRD §4.4 — a beneficiary "can trigger an
 * 'Objection'" as a distinct, triage-worthy action from a plain message;
 * `type` defaults to MESSAGE so an ordinary note doesn't land in a staff
 * objection queue by accident. */
export class CreateRelayMessageDto {
  @IsString()
  @MinLength(1)
  body: string;

  @IsOptional()
  @IsEnum(BeneficiaryRelayMessageType)
  type?: BeneficiaryRelayMessageType;
}
