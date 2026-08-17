import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ArrivalArrangementType } from '@prisma/client';

export class CreateArrivalArrangementDto {
  @IsEnum(ArrivalArrangementType)
  type: ArrivalArrangementType;

  @IsOptional()
  @IsString()
  detail?: string;
}
