import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

/** Finance records what an agent earned on a case that has already passed
 * QC — mirrors RecordDirectCostDto's shape and discipline (see
 * commerce.service.ts's recordDirectCost). Deliberately no fee formula
 * fills this in automatically; nothing in this codebase ties a case's
 * price to an agent's cut. */
export class RecordEarningDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;
}
