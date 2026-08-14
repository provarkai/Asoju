import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RaiseDisputeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  detail: string;
}
