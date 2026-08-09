import { Injectable, Logger } from '@nestjs/common';

/**
 * Outbound side of the WhatsApp integration. Without real provider
 * credentials configured, this runs in dry-run mode — it logs what would
 * have been sent and returns `sent: false` rather than pretending to have
 * delivered a message. Wire in Twilio's Messages API (or 360dialog's) here
 * once TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_FROM are set —
 * the interface (`sendMessage`) is what the rest of the app depends on, so
 * that swap needs no other code changes.
 */
@Injectable()
export class WhatsappSenderService {
  private readonly logger = new Logger(WhatsappSenderService.name);

  isConfigured(): boolean {
    return Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM,
    );
  }

  async sendMessage(toPhone: string, text: string): Promise<{ sent: boolean; dryRun: boolean }> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `WhatsApp send is not configured (dry run) — would have sent to ${toPhone}: "${text.slice(0, 80)}"`,
      );
      return { sent: false, dryRun: true };
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const authToken = process.env.TWILIO_AUTH_TOKEN!;
    const from = process.env.TWILIO_WHATSAPP_FROM!;

    const params = new URLSearchParams({
      From: `whatsapp:${from}`,
      To: `whatsapp:${toPhone}`,
      Body: text,
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`WhatsApp send failed (${response.status}): ${errorBody}`);
      return { sent: false, dryRun: false };
    }

    return { sent: true, dryRun: false };
  }
}
