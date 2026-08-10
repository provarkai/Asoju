import { IsOptional, IsString, MinLength } from 'class-validator';

export class RaiseExceptionDto {
  @IsString()
  @MinLength(3)
  label: string;

  @IsOptional()
  @IsString()
  detail?: string;
}
