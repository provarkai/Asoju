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
