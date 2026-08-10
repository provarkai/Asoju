import { IsObject, IsOptional } from 'class-validator';

/** Free-form so it works whether the client sent GPS coords or a plain address string. */
export class CheckInDto {
  @IsOptional()
  @IsObject()
  location?: Record<string, unknown>;
}
