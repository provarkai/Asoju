import { AccountType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;
}
