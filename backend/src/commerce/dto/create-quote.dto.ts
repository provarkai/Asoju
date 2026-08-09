import { IsNumber, IsObject, IsOptional, IsPositive, IsString, Length } from 'class-validator';

/** Section 6 — "Every service must have ... pricing method" before it goes live. */
export class CreateQuoteDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsObject()
  breakdown?: Record<string, unknown>;
}
