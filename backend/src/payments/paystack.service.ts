import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { CircuitBreaker } from '../common/resilience/circuit-breaker';

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

/** Paystack's own transaction-status vocabulary
 * (GET /transaction/verify/:reference) — 'success'/'failed'/'abandoned'
 * are terminal; 'pending'/'ongoing'/'queued' are still in flight (an
 * ongoing bank-transfer or USSD confirmation, mid-3DS, etc). */
export type PaystackVerifyStatus = 'success' | 'failed' | 'abandoned' | 'pending' | 'ongoing' | 'queued' | 'reversed';

export interface VerifyTransactionResult {
  dryRun: boolean;
  /** Undefined only in dry-run mode — nothing to report without a real
   * provider to ask. */
  status?: PaystackVerifyStatus;
  amountKobo?: number;
  gatewayResponse?: string;
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

  /** Ported from fieldforce/src/lib/circuit-breaker.ts's preconfigured
   * `paystackBreaker` (same threshold/timeouts — same provider, same
   * failure profile). Unlike WhatsApp/Email, these methods already throw
   * on failure rather than swallowing it into a `{sent:false}` shape, so
   * wrapping just means a CircuitBreakerError propagates the same way a
   * fetch/parse error already did — no behavioural change beyond "stop
   * hammering Paystack once it's clearly down." */
  private readonly breaker = CircuitBreaker.register(
    new CircuitBreaker({ name: 'paystack', failureThreshold: 3, resetTimeoutMs: 30_000, timeoutMs: 15_000 }),
  );

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

    return this.breaker.execute(async () => {
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
    });
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

    return this.breaker.execute(async () => {
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
    });
  }

  /**
   * P0 Technical Build Spec Section 20/21 "Payment Architecture" —
   * `PaymentStatus.PROCESSING` existed in the enum with nothing ever
   * setting it: the only way a payment's real state ever reached this app
   * was the webhook, and a payment that's genuinely in flight (an ongoing
   * bank transfer, mid-3DS) has nowhere to sit but PENDING regardless of
   * what Paystack itself reports. This is the other leg — a poll of
   * Paystack's own source of truth (GET /transaction/verify/:reference),
   * for the case a webhook is late or never arrives. Same dry-run pattern
   * as everywhere else: without PAYSTACK_SECRET_KEY there's no live
   * provider to ask, so this returns `{ dryRun: true }` and the caller
   * (CommerceService.runPaymentVerificationSweep) skips it entirely rather
   * than inventing a status.
   */
  async verifyTransaction(reference: string): Promise<VerifyTransactionResult> {
    if (!this.secretKey) {
      this.logger.warn(`[dry-run] Paystack verify skipped (PAYSTACK_SECRET_KEY not set) — reference=${reference}`);
      return { dryRun: true };
    }

    return this.breaker.execute(async () => {
      const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
      });

      const body = (await res.json().catch(() => ({}))) as {
        status?: boolean;
        message?: string;
        data?: { status: PaystackVerifyStatus; amount: number; gateway_response?: string };
      };

      if (!res.ok || !body.status || !body.data) {
        throw new Error(`Paystack verify failed: ${body.message ?? res.statusText}`);
      }

      return {
        dryRun: false,
        status: body.data.status,
        amountKobo: body.data.amount,
        gatewayResponse: body.data.gateway_response,
      };
    });
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
