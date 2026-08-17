import { IsIn } from 'class-validator';
import { ESCALATION_CHANNELS } from '../agent-sos.service';

export class EscalateSosDto {
  @IsIn(ESCALATION_CHANNELS)
  channel: (typeof ESCALATION_CHANNELS)[number];
}
