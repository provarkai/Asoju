import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Stand-in for real WhatsApp Business API signature verification — same
 * pattern as WebhookSecretGuard for payments. A real Twilio/360dialog
 * integration would validate `X-Twilio-Signature` (an HMAC over the exact
 * callback URL + sorted form params, keyed by your Twilio Auth Token) or
 * the equivalent for whichever BSP is used; replace this guard's body with
 * that when real credentials exist, without touching the controller.
 */
@Injectable()
export class WhatsappWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-webhook-secret'];
    const expected = process.env.WHATSAPP_WEBHOOK_SECRET;

    if (!expected) {
      throw new UnauthorizedException('WhatsApp webhook is not configured');
    }
    if (provided !== expected) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
    return true;
  }
}
