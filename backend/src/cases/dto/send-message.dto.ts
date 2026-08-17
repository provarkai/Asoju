import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Case messaging (customer <-> staff) — `channel` is always 'web' for a
 * message sent through this endpoint; WhatsApp-originated messages land in
 * the same Message table via WhatsappService instead, never through here. */
export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body: string;
}
