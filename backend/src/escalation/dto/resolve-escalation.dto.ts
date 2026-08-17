import { IsString, MinLength } from 'class-validator';

export class ResolveEscalationDto {
  @IsString()
  @MinLength(1)
  resolutionNotes: string;
}
