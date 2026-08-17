import { IsEmail } from 'class-validator';

export class CreatePartnerContactDto {
  @IsEmail()
  email: string;
}
