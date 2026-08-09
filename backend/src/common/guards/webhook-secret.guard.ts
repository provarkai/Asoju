import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Stand-in for real payment-provider signature verification (Paystack/
 * Flutterwave sign webhooks with HMAC over the raw body). A shared secret
 * is enough to prove the caller isn't a random customer-facing request
 * while a real provider integration isn't wired up yet — this guard is the
 * single place that would be replaced with real signature verification.
 */
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-webhook-secret'];
    const expected = process.env.PAYMENT_WEBHOOK_SECRET;

    if (!expected) {
      throw new UnauthorizedException('Payment webhook is not configured');
    }
    if (provided !== expected) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
    return true;
  }
}
