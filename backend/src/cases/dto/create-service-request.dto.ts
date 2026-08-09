import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Raw inbound request (pre-case), per Section 7.2 message 2 — the customer's
 * ask in their own words. `serviceType` is left optional/nullable here
 * because classifying it is the AI Concierge's job (Section 7.5
 * data_collected.service_type); a human/AI populates it before conversion.
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
}
