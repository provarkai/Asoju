import { IsBoolean } from 'class-validator';

export class SetAgentActiveDto {
  @IsBoolean()
  isActive: boolean;
}
