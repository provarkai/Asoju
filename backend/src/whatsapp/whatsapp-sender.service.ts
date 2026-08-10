import { Injectable, Logger } from '@nestjs/common';

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

    const apiKey = process.env.ZAVU_API_KEY!;
    const senderId = process.env.ZAVU_SENDER_ID;

    const response = await fetch(`${ZAVU_API_BASE}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(senderId ? { 'Zavu-Sender': senderId } : {}),
      },
      body: JSON.stringify({
        to: toPhone,
        channel: 'whatsapp',
        text,
        // This is a conversational AI reply, not a notification — never
        // silently reroute it to SMS if WhatsApp delivery fails (Zavu
        // defaults fallbackEnabled to true, which would otherwise text a
        // customer expecting a WhatsApp thread from an unrecognised SMS
        // sender instead).
        fallbackEnabled: false,
      }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as ZavuErrorResponse | null;
      this.logger.error(
        `WhatsApp send failed (${response.status}): ${errorBody?.code ?? 'unknown'} — ${errorBody?.message ?? 'no error body'}`,
      );
      return { sent: false, dryRun: false };
    }

    const body = (await response.json()) as ZavuMessageResponse;
    if (body.message.errorCode) {
      this.logger.error(`WhatsApp send accepted but failed downstream: ${body.message.errorCode} — ${body.message.errorMessage}`);
      return { sent: false, dryRun: false };
    }

    return { sent: true, dryRun: false };
  }
}
