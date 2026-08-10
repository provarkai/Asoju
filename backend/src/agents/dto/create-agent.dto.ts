import { IsEmail, IsOptional, IsPhoneNumber, IsString, MinLength } from 'class-validator';

/**
 * Admin-initiated onboarding (Section 5.3 — Ops Console "Agent & provider
 * management"). Unlike customer self-registration, staff choose the
 * agent's initial password directly and hand it over out-of-band; there's
 * no self-service field-agent signup in MVP.
 */
export class CreateAgentDto {
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;
}
