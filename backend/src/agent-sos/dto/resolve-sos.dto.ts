import { IsString, MinLength } from 'class-validator';

export class ResolveSosDto {
  @IsString()
  @MinLength(3)
  resolutionNotes: string;
}
