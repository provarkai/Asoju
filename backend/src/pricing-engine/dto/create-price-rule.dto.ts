import { IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { PricingZone, ServiceType } from '@prisma/client';

export class CreatePriceRuleDto {
  @IsEnum(ServiceType)
  serviceType: ServiceType;

  // PricingZone.OTHER deliberately rejected — see PricingEngineService's
  // comment on why that zone stays unpriced.
  @IsEnum([PricingZone.LAGOS, PricingZone.SOUTH_WEST])
  zone: PricingZone;

  @IsNumber()
  @IsPositive()
  value: number;

  @IsString()
  @MinLength(1)
  label: string;

  @IsOptional()
  @IsInt()
  priority?: number;
}
