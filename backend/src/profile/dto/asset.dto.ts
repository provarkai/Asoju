import { IsOptional, IsString, MinLength } from 'class-validator';

/** Section 3 — Asset: generalized farm, business premises, equipment, vehicle. */
export class CreateAssetDto {
  @IsString()
  @MinLength(2)
  assetType: string; // farm | business_premises | equipment | vehicle | ...

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  location?: string;
}
