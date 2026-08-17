import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Section 12 P1 "WhatsApp AI integration". Shape is deliberately simple
 * JSON (`from`/`body`) rather than the real WhatsApp Business API's exact
 * webhook payload — a live Twilio/360dialog integration would need to
 * parse that provider's actual format (Twilio sends form-encoded `From`/
 * `Body`/`MessageSid` etc. and signs requests via `X-Twilio-Signature`,
 * which WhatsappWebhookGuard's shared-secret check stands in for here).
 *
 * `interactiveReplyId` is Platform Expansion PRD §6.1's addition — the
 * real WhatsApp Business Cloud API nests this at
 * `entry[].changes[].value.messages[].interactive.button_reply.id`; this
 * flat field stands in for that the same way `from`/`body` stand in for
 * the rest of the real payload shape.
 */
export class InboundMessageDto {
  @IsString()
  @MinLength(1)
  from: string;

  @IsString()
  @MinLength(1)
  body: string;

  @IsOptional()
  @IsString()
  interactiveReplyId?: string;
}
