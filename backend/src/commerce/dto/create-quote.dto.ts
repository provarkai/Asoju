import { ArrayMinSize, IsArray, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateQuoteLineDto } from './create-quote-line.dto';

/** Section 6 — "Every service must have ... pricing method" before it goes
 * live. P0 Technical Build Spec Section 15/16 "Quote Engine / Quote Line
 * Categories" — a quote is its categorized lines, not a single flat
 * amount; CommerceService.createQuote() sums them (ASOJU_SERVICE_FEE
 * separately from everything else) to get the discount-eligible base and
 * the grand total. */
export class CreateQuoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateQuoteLineDto)
  lines: CreateQuoteLineDto[];

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
