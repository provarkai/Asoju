import { IsString } from 'class-validator';

export class AssignRmDto {
  @IsString()
  rmUserId: string;
}
