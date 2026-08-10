import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** P0 Tech Platform §9 "Case Control Requirements" — "what happens next,
 * when is it due." `nextAction` is always required — a cleared next
 * action is still a decision (pass an empty-string-free value), not an
 * accidental omission; `dueAt` is optional since not every next action has
 * a hard deadline. */
export class SetNextActionDto {
  @IsString()
  @IsNotEmpty()
  nextAction: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
