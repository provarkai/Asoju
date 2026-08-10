import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class ScAdjustmentDto {
  /** May be negative — a signed correction, not a top-up amount. */
  @IsNumber()
  amountUsd: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
