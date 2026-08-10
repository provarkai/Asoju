import { IsInt, Max, Min } from 'class-validator';

export class CreateScheduleDto {
  @IsInt()
  @Min(7)
  @Max(365)
  cadenceDays: number;
}
