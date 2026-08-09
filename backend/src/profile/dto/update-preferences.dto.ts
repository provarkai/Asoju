import { IsIn } from 'class-validator';

/** Section 5.1 P1 — "notification preferences". */
export class UpdatePreferencesDto {
  @IsIn(['whatsapp', 'email', 'sms'])
  preferredChannel: string;
}
