import { IsEmail, IsIn, IsOptional, IsPhoneNumber, IsString, MinLength } from 'class-validator';

/**
 * Public self-registration is for customers only (Section 5.1 onboarding —
 * progressive disclosure: name, country of residence, phone/email,
 * preferred channel only, nothing more up front). Staff/agent/provider
 * accounts are created through internal/admin flows, not this endpoint.
 */
export class RegisterDto {
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

  @IsString()
  countryOfResidence: string;

  @IsOptional()
  @IsIn(['whatsapp', 'email', 'sms'])
  preferredChannel?: string;

  /** Section 12 P1 — "referral system". Another customer's referral code. */
  @IsOptional()
  @IsString()
  referralCode?: string;
}
