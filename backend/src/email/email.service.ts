import { Injectable, Logger } from '@nestjs/common';

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
      this.logger.error(`Email send failed (${response.status}): ${errorBody}`);
      return { sent: false, dryRun: false };
    }

    return { sent: true, dryRun: false };
  }
}
