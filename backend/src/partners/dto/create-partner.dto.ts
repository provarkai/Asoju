import { PartnerType } from '@prisma/client';
import { IsEnum, IsString, MinLength } from 'class-validator';

export class CreatePartnerDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEnum(PartnerType)
  type: PartnerType;
}
