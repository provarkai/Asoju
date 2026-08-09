import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateUniqueReferralCode } from '../common/referral-code';
import { AiService } from '../ai/ai.service';
import { ConversationTurnDto } from '../ai/dto/concierge-message.dto';
import { WhatsappSenderService } from './whatsapp-sender.service';

/**
 * Section 12 P1 "WhatsApp AI integration" — Section 7.2's conversation
 * flow, over WhatsApp instead of the web chat widget. Reuses AiService's
 * converse() exactly as the web client does; the only thing this module
 * adds is resolving a phone number to a customer identity and persisting
 * conversation history server-side (WhatsAppThread), since there's no
 * browser to hold it between webhook calls.
 *
 * NEEDS A REAL PROVIDER TO VERIFY LIVE — see WhatsappWebhookGuard and
 * WhatsappSenderService for the two integration points a real
 * Twilio/360dialog account would replace.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly aiService: AiService,
    private readonly sender: WhatsappSenderService,
  ) {}

  async handleInboundMessage(rawFrom: string, body: string) {
    const phone = this.normalizePhone(rawFrom);
    const { user, thread } = await this.resolveThread(phone);

    const history = (thread.history as unknown as ConversationTurnDto[]) ?? [];

    const result = await this.aiService.converse(
      { id: user.id, role: Role.CUSTOMER, email: user.email },
      { message: body, history },
    );

    const updatedHistory: ConversationTurnDto[] = [
      ...history,
      { role: 'user', content: body },
      { role: 'assistant', content: result.reply },
    ];

    await this.prisma.whatsAppThread.update({
      where: { id: thread.id },
      data: { history: updatedHistory as any },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'ai',
      action: 'whatsapp.message_handled',
      metadata: { escalate: result.escalate, conversationComplete: result.conversationComplete },
    });

    const sendResult = await this.sender.sendMessage(phone, result.reply);
    if (sendResult.dryRun) {
      this.logger.warn(`WhatsApp reply not actually delivered (no provider configured) for ${phone}`);
    }

    return { reply: result.reply, ...sendResult };
  }

  /** Twilio prefixes WhatsApp numbers with "whatsapp:" — strip it if present. */
  private normalizePhone(raw: string): string {
    return raw.replace(/^whatsapp:/i, '').trim();
  }

  private async resolveThread(phone: string) {
    const existing = await this.prisma.whatsAppThread.findUnique({
      where: { phone },
      include: { user: true },
    });
    if (existing) return { user: existing.user, thread: existing };

    // First-ever message from this number — Section 7.2's "front door":
    // no prior registration required, a phone-only account is created on
    // the spot (Section 5.1 progressive disclosure, taken to its logical
    // extreme for the channel with the lowest-friction entry point).
    const referralCode = await generateUniqueReferralCode(this.prisma);
    const user = await this.prisma.user.create({
      data: {
        phone,
        role: Role.CUSTOMER,
        preferredChannel: 'whatsapp',
        customer: { create: { fullName: 'WhatsApp Customer', referralCode } },
      },
    });
    const thread = await this.prisma.whatsAppThread.create({
      data: { phone, userId: user.id, history: [] },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'system',
      action: 'whatsapp.customer_created',
      metadata: { phone },
    });

    return { user, thread };
  }
}
