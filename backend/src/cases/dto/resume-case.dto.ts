import { IsOptional, IsString } from 'class-validator';

/** Resuming doesn't need a reason the way holding does — the block being
 * lifted is usually self-explanatory (the thing that was missing showed
 * up) — but staff can record one if it isn't. */
export class ResumeCaseDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
