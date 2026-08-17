import { IsEnum, IsNumber, IsPositive } from 'class-validator';
import { CasePriority, MultiplierType } from '@prisma/client';

export class CreateMultiplierRuleDto {
  @IsEnum(MultiplierType)
  type: MultiplierType;

  // Required in practice today since MultiplierType only has URGENCY, but
  // kept as its own field (not folded into `type`) so a future non-
  // priority-triggered multiplier type doesn't need a breaking DTO change.
  @IsEnum(CasePriority)
  casePriority: CasePriority;

  @IsNumber()
  @IsPositive()
  multiplier: number;
}
