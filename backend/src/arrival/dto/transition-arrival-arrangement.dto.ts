import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ArrivalArrangementStatus } from '@prisma/client';

export class TransitionArrivalArrangementDto {
  @IsEnum(ArrivalArrangementStatus)
  status: ArrivalArrangementStatus;

  /** Updates the recorded detail in the same call as the transition —
   * e.g. moving to CONFIRMED is the natural moment to record exactly who/
   * what was confirmed. Optional: a status-only transition leaves the
   * existing detail untouched. */
  @IsOptional()
  @IsString()
  detail?: string;

  /** Required by the state machine itself for CANCELLED/CHANGED — see
   * arrival-arrangement-state-machine.ts. */
  @IsOptional()
  @IsString()
  note?: string;
}
