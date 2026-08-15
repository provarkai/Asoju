import { IsOptional, IsString, Length } from 'class-validator';

export class CreatePriceBookDto {
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
