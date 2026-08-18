import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateCaseTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}
