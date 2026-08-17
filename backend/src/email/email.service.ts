import { Injectable, Logger } from '@nestjs/common';
import { CircuitBreaker, CircuitBreakerError } from '../common/resilience/circuit-breaker';

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'ASOJU <onboarding@resend.dev>';

/**
 * Section 11.2: "Explicitly do not build ... email infra" — this wraps a
 * bought provider, Resend (resend.com), never a home-rolled SMTP client.
 * Without a real API key configured, this runs in dry-run mode — it logs
 * what would have been sent and returns `sent: false` rather than
 * pretending to have delivered anything, same pattern as every other
 * integration in this repo (Paystack, Zavu, S3).
 *
 * `onboarding@resend.dev` (Resend's default shared sender) only delivers
 * to the Resend account's own verified email address until a real sending
 * domain is verified in their dashboard — set RESEND_FROM_EMAIL once that
 * domain exists. Until then, expect real 403s from Resend for any other
 * recipient; that's Resend's sandbox working as documented, not a bug
 * here (see WhatsappSenderService's Zavu sandbox note for the same shape
 * of restriction on a different provider).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  /** Same "protect the request path from a degrading provider" rationale
   * as WhatsappSenderService's breaker — ported from FieldForce's
   * circuit-breaker.ts, which had no ASOJU-backend equivalent before now. */
  private readonly breaker = CircuitBreaker.register(
    new CircuitBreaker({ name: 'resend-email', failureThreshold: 5, resetTimeoutMs: 30_000, timeoutMs: 10_000 }),
  );

  isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY);
  }

  async sendEmail(to: string, subject: string, html: string): Promise<{ sent: boolean; dryRun: boolean }> {
    if (!this.isConfigured()) {
      this.logger.warn(`Email send is not configured (dry run) — would have sent to ${to}: "${subject}"`);
      return { sent: false, dryRun: true };
    }

    const apiKey = process.env.RESEND_API_KEY!;
    const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;

    try {
      return await this.breaker.execute(async () => {
        const response = await fetch(RESEND_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from, to, subject, html }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          // Thrown so the breaker counts it — see WhatsappSenderService's
          // postMessage for why a non-2xx counts the same as a network
          // failure here.
          throw new Error(`Email send failed (${response.status}): ${errorBody}`);
        }

        return { sent: true, dryRun: false };
      });
    } catch (error) {
      if (error instanceof CircuitBreakerError) {
        this.logger.error(`Email send blocked — ${error.message}`);
      } else {
        this.logger.error(error instanceof Error ? error.message : 'Email send failed');
      }
      return { sent: false, dryRun: false };
    }
  }
}
