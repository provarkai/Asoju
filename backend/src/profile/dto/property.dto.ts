import { IsOptional, IsString, MinLength } from 'class-validator';

/** Section 5.1 P1 — "saved properties/assets". */
export class CreatePropertyDto {
  @IsString()
  @MinLength(3)
  address: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
