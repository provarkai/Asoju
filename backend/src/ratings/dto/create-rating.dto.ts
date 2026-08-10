import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  stars: number;

  @IsOptional()
  @IsString()
  comment?: string;

  /** Public trust page — opt-in, off by default (Rating.publicConsent). */
  @IsOptional()
  @IsBoolean()
  publicConsent?: boolean;
}
