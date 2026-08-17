import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/** Section 5.1 P1 — "notification preferences", broadened to cover the
 * rest of what register.dto.ts captures at signup (fullName,
 * countryOfResidence, phone) but had no update path for afterward.
 * fullName lives on Customer, the rest on User — updatePreferences
 * below writes both in one transaction when both are present. Every
 * field optional and only touched if sent, same "send what changed"
 * convention as ProfileService.getPortfolio's callers already use. */
export class UpdatePreferencesDto {
  @IsOptional()
  @IsIn(['whatsapp', 'email', 'sms'])
  preferredChannel?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsString()
  countryOfResidence?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
