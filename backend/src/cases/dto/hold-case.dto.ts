import { IsNotEmpty, IsString } from 'class-validator';

/** P0 Tech Platform §8 "Case Status Model" — ON HOLD: "Blocked pending
 * information/decision/condition." `reason` is always required — same
 * discipline as every other material action this session (refunds,
 * reconciliation), never a silent pause. */
export class HoldCaseDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
