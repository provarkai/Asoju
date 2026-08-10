import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

export interface InitializeTransactionParams {
  email: string;
  /** Paystack amounts are in kobo (smallest unit of NGN), not naira. */
  amountKobo: number;
  reference: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
  dryRun: boolean;
}

export interface RefundTransactionResult {
  dryRun: boolean;
}

/**
 * Section 12 "real payment-provider integration" — replaces
 * WebhookSecretGuard's shared-secret stand-in with Paystack's actual
 * contract: initialize a hosted-checkout transaction, then verify inbound
 * webhooks by HMAC-SHA512 over the raw request body, exactly how Paystack
 * signs them. Section 11.2 is explicit that ASOJU integrates with a
 * licensed gateway rather than building one — this is that integration,
 * not a processor.
 *
 * Without PAYSTACK_SECRET_KEY, `initializeTransaction` dry-runs (logs,
 * returns a synthetic checkout URL, charges nothing) — the same pattern as
 * WhatsappSenderService. `verifySignature` has no dry-run mode: without a
 * key it always fails closed, because that method is the whole trust
 * boundary Non-Negotiable #4 depends on.
 */
@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);

  private get secretKey(): string | undefined {
    return process.env.PAYSTACK_SECRET_KEY || undefined;
  }

  async initializeTransaction(params: InitializeTransactionParams): Promise<InitializeTransactionResult> {
    const { email, amountKobo, reference, currency = 'NGN', metadata } = params;

    if (!this.secretKey) {
      this.logger.warn(
        `[dry-run] Paystack initialize skipped (PAYSTACK_SECRET_KEY not set) — reference=${reference} amountKobo=${amountKobo}`,
      );
      return {
        authorizationUrl: `https://paystack.test/dry-run/${reference}`,
        accessCode: `dry-run-${reference}`,
        reference,
        dryRun: true,
      };
    }

    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, amount: amountKobo, reference, currency, metadata }),
    });

    const body = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: { authorization_url: string; access_code: string; reference: string };
    };

    if (!res.ok || !body.status || !body.data) {
      throw new Error(`Paystack initialize failed: ${body.message ?? res.statusText}`);
    }

    return {
      authorizationUrl: body.data.authorization_url,
      accessCode: body.data.access_code,
      reference: body.data.reference,
      dryRun: false,
    };
  }

  /**
   * P0 Technical Build Spec Section 20/21 "Payment Architecture" — "Support
   * failed, pending, reversed and refunded states." Same dry-run pattern as
   * initializeTransaction: without PAYSTACK_SECRET_KEY this logs and
   * returns without calling out, so CommerceService.refundPayment can
   * record the refund locally (the authorized-actor + reason + audit trail
   * is the actual source of truth here, same as ScLedgerService.adjust)
   * even in an environment with no live payment provider configured.
   */
  async refundTransaction(providerReference: string, amountKobo: number): Promise<RefundTransactionResult> {
    if (!this.secretKey) {
      this.logger.warn(
        `[dry-run] Paystack refund skipped (PAYSTACK_SECRET_KEY not set) — reference=${providerReference} amountKobo=${amountKobo}`,
      );
      return { dryRun: true };
    }

    const res = await fetch('https://api.paystack.co/refund', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transaction: providerReference, amount: amountKobo }),
    });

    const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string };
    if (!res.ok || !body.status) {
      throw new Error(`Paystack refund failed: ${body.message ?? res.statusText}`);
    }

    return { dryRun: false };
  }

  /** HMAC-SHA512 over the raw request body — Paystack's `x-paystack-signature` scheme. */
  verifySignature(rawBody: Buffer | undefined, signatureHeader: unknown): boolean {
    if (!this.secretKey || !rawBody || typeof signatureHeader !== 'string' || !signatureHeader) {
      return false;
    }

    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(signatureHeader, 'utf8');
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  }
}
