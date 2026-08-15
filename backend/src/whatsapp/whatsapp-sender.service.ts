import { Injectable, Logger } from '@nestjs/common';
import { CircuitBreaker, CircuitBreakerError } from '../common/resilience/circuit-breaker';

const ZAVU_API_BASE = 'https://api.zavu.dev/v1';

interface ZavuMessageResponse {
  message: {
    id: string;
    status: string;
    providerMessageId?: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  };
}

interface ZavuErrorResponse {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Outbound side of the WhatsApp integration — Zavu (docs.zavu.dev), a
 * unified messaging API sitting in front of Meta's Cloud API so this app
 * never has to hold a Meta Business account directly (Section 11.2:
 * "buy, don't build" WhatsApp infra). Without a real API key configured,
 * this runs in dry-run mode — it logs what would have been sent and
 * returns `sent: false` rather than pretending to have delivered a
 * message, same pattern as Paystack/S3 elsewhere in this repo.
 *
 * A `zv_test_...` key (Zavu's own sandbox key format) hits this same
 * endpoint and gets a real 2xx response, but Zavu documents that test
 * keys simulate sending and never actually reach a phone — so
 * `sent: true, dryRun: false` from this service only means "Zavu accepted
 * the request," not "a message was delivered," whenever a test key is in
 * use. There is no reliable way to tell a test key from a live one from
 * its response shape, only from the `zv_test_`/`zv_live_` prefix itself.
 */
@Injectable()
export class WhatsappSenderService {
  private readonly logger = new Logger(WhatsappSenderService.name);

  /** Ported from fieldforce/src/lib/circuit-breaker.ts's preconfigured
   * breakers — Zavu sits in the critical path of report issuance, case
   * approval, and every channel-fanout notification, so a Zavu outage
   * shouldn't mean every one of those requests hangs for the full fetch
   * timeout, repeatedly, until Zavu recovers. */
  private readonly breaker = CircuitBreaker.register(
    new CircuitBreaker({ name: 'zavu-whatsapp', failureThreshold: 3, resetTimeoutMs: 30_000, timeoutMs: 10_000 }),
  );

  isConfigured(): boolean {
    return Boolean(process.env.ZAVU_API_KEY);
  }

  async sendMessage(toPhone: string, text: string): Promise<{ sent: boolean; dryRun: boolean }> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `WhatsApp send is not configured (dry run) — would have sent to ${toPhone}: "${text.slice(0, 80)}"`,
      );
      return { sent: false, dryRun: true };
    }

    return this.postMessage({
      to: toPhone,
      channel: 'whatsapp',
      text,
      // This is a conversational AI reply, not a notification — never
      // silently reroute it to SMS if WhatsApp delivery fails (Zavu
      // defaults fallbackEnabled to true, which would otherwise text a
      // customer expecting a WhatsApp thread from an unrecognised SMS
      // sender instead).
      fallbackEnabled: false,
    });
  }

  /** Platform Expansion PRD §6.1 "Deeper WhatsApp-first case approval" —
   * a report-ready notification with tappable Approve/Request-changes
   * buttons instead of plain text, so a customer can act without typing.
   * Button `id`s are echoed back verbatim on reply (see
   * case-approval-buttons.ts) — that's a general WhatsApp Business
   * Cloud API interactive-message convention, not confirmed against
   * Zavu's own docs specifically (same caveat as WhatsappWebhookGuard's
   * inbound signature gap — verify byte-for-byte against a real Zavu
   * payload before this carries real customer approvals). Dry-run-safe
   * same as sendMessage. */
  async sendApprovalRequest(
    toPhone: string,
    caseNumber: string,
    buttons: { id: string; title: string }[],
  ): Promise<{ sent: boolean; dryRun: boolean }> {
    const bodyText = `Your report for ${caseNumber} is ready for review.`;
    if (!this.isConfigured()) {
      this.logger.warn(
        `WhatsApp interactive approval request is not configured (dry run) — would have sent to ${toPhone}: "${bodyText}" with buttons ${buttons.map((b) => b.title).join(', ')}`,
      );
      return { sent: false, dryRun: true };
    }

    return this.postMessage({
      to: toPhone,
      channel: 'whatsapp',
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
      },
      fallbackEnabled: false,
    });
  }

  private async postMessage(payload: Record<string, unknown>): Promise<{ sent: boolean; dryRun: boolean }> {
    const apiKey = process.env.ZAVU_API_KEY!;
    const senderId = process.env.ZAVU_SENDER_ID;

    try {
      return await this.breaker.execute(async () => {
        const response = await fetch(`${ZAVU_API_BASE}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(senderId ? { 'Zavu-Sender': senderId } : {}),
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => null)) as ZavuErrorResponse | null;
          // Thrown (not just logged) so the circuit breaker counts a
          // non-2xx response as a real failure, same as a network error —
          // sustained 401s (e.g. a revoked key) should trip the breaker
          // exactly like Zavu being unreachable would.
          throw new Error(
            `WhatsApp send failed (${response.status}): ${errorBody?.code ?? 'unknown'} — ${errorBody?.message ?? 'no error body'}`,
          );
        }

        const body = (await response.json()) as ZavuMessageResponse;
        if (body.message.errorCode) {
          throw new Error(`WhatsApp send accepted but failed downstream: ${body.message.errorCode} — ${body.message.errorMessage}`);
        }

        return { sent: true, dryRun: false };
      });
    } catch (error) {
      if (error instanceof CircuitBreakerError) {
        this.logger.error(`WhatsApp send blocked — ${error.message}`);
      } else {
        this.logger.error(error instanceof Error ? error.message : 'WhatsApp send failed');
      }
      return { sent: false, dryRun: false };
    }
  }
}
