import { IsEmail, IsString, MinLength } from 'class-validator';

/** "Who is a Beneficiary" (portal access) — the invited person supplies
 * their own login identity (email — same as every other role in this
 * app) and password when claiming the invite. */
export class AcceptBeneficiaryInviteDto {
  @IsString()
  token: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
