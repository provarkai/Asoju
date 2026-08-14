import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class RecordPayoutDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;
}
