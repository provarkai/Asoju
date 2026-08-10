import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Stand-in for real webhook signature verification — the shared-secret
 * pattern PaystackWebhookGuard replaced for payments. Provider is Zavu
 * (docs.zavu.dev): confirmed from their docs that inbound webhooks carry
 * an `X-Zavu-Signature` header and a per-sender secret shaped like
 * `whsec_...` (returned once, from `POST /v1/senders/:id/webhook/secret`)
 * — but NOT confirmed is the exact signing algorithm/canonical string
 * (their public docs reference "the Security guide" for this without
 * exposing it to an unauthenticated fetch). Do not guess at that from
 * this comment alone: pull the exact scheme from Zavu's dashboard/support
 * before replacing this guard, the same way PaystackWebhookGuard's
 * HMAC-SHA512 was verified byte-for-byte against Paystack's own docs
 * before being trusted with "only a verified webhook may mark a payment
 * PAID" (Non-Negotiable #4) — a webhook guard is exactly the wrong place
 * for an unverified guess.
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
