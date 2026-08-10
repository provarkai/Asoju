import { IsEnum, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { DirectCostCategory } from '@prisma/client';

/** P0 Tech Platform §33 "Financial & Analytics Requirements" — "Representative
 * cost. Travel/transport. Third-party costs. Other direct cost." Finance
 * records each cost against the case as it's incurred; `note` is optional
 * (unlike RefundPaymentDto's reason) since a category is often
 * self-explanatory, but recommended for anything non-obvious. */
export class RecordDirectCostDto {
  @IsEnum(DirectCostCategory)
  category: DirectCostCategory;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
