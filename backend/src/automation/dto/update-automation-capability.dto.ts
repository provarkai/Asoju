import { IsBoolean } from 'class-validator';

export class UpdateAutomationCapabilityDto {
  @IsBoolean()
  enabled: boolean;
}
