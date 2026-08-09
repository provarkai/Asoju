import { IsString, MinLength } from 'class-validator';

/**
 * Section 12 P1 "WhatsApp AI integration". Shape is deliberately simple
 * JSON (`from`/`body`) rather than the real WhatsApp Business API's exact
 * webhook payload — a live Twilio/360dialog integration would need to
 * parse that provider's actual format (Twilio sends form-encoded `From`/
 * `Body`/`MessageSid` etc. and signs requests via `X-Twilio-Signature`,
 * which WhatsappWebhookGuard's shared-secret check stands in for here).
 */
export class InboundMessageDto {
  @IsString()
  @MinLength(1)
  from: string;

  @IsString()
  @MinLength(1)
  body: string;
}
