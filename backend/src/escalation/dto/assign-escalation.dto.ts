import { IsString, MinLength } from 'class-validator';

export class AssignEscalationDto {
  @IsString()
  @MinLength(1)
  assignedToId: string;
}
