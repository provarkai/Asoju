import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** All fields optional — a Finance/Admin edit can change just the one
 * figure they mean to (e.g. a discount bump without touching price). */
export class UpdatePlanConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  scGrantUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  eligibleRequestsPerMonth?: number;
}
