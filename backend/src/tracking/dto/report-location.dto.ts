import { IsDateString, IsNumber, IsOptional } from 'class-validator';

export class ReportLocationDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsOptional()
  @IsNumber()
  accuracy?: number;

  @IsOptional()
  @IsDateString()
  capturedAt?: string;
}
