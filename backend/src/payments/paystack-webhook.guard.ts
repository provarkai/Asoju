import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PaystackService } from './paystack.service';

/**
 * Replaces WebhookSecretGuard for payments — the single place real
 * Paystack webhook trust is enforced (Non-Negotiable #4). Requires
 * main.ts to bootstrap with `{ rawBody: true }` so `request.rawBody` holds
 * the exact bytes Paystack signed; re-serializing the parsed JSON body
 * would not reproduce the same HMAC and would always fail verification.
 */
@Injectable()
export class PaystackWebhookGuard implements CanActivate {
  constructor(private readonly paystack: PaystackService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature = request.headers['x-paystack-signature'];
    const rawBody: Buffer | undefined = request.rawBody;

    if (!this.paystack.verifySignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid Paystack signature');
    }
    return true;
  }
}
