import { IsString, Length, MinLength } from 'class-validator';

export class ConfirmMfaDto {
  @IsString()
  @Length(6, 6)
  code: string;
}

export class DisableMfaDto {
  @IsString()
  @MinLength(1)
  password: string;
}

export class VerifyMfaDto {
  @IsString()
  mfaToken: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

/** Security hardening — "Privileged Admin accounts should require MFA"
 * (Admin Console & Platform Admin Architecture v1.0 Section 4 / UX/UI
 * Specification Section 42). Body for the two restricted-token endpoints a
 * privileged user without MFA enabled is handed at login instead of real
 * session tokens — enrollmentToken authorizes exactly these two calls,
 * nothing else (see AuthService.mfaPendingSecret / purpose check). */
export class StartMfaEnrollmentDto {
  @IsString()
  enrollmentToken: string;
}

export class ConfirmMfaEnrollmentDto {
  @IsString()
  enrollmentToken: string;

  @IsString()
  @Length(6, 6)
  code: string;
}
