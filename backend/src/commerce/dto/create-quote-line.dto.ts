import { IsEnum, IsNumber, IsPositive, IsString, MinLength } from 'class-validator';
import { QuoteLineCategory } from '@prisma/client';

/** P0 Technical Build Spec Section 16 "Quote Line Categories". */
export class CreateQuoteLineDto {
  @IsEnum(QuoteLineCategory)
  category: QuoteLineCategory;

  @IsString()
  @MinLength(1)
  label: string;

  @IsNumber()
  @IsPositive()
  amount: number;
}
