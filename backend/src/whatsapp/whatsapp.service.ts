import { Injectable, Logger } from '@nestjs/common';
import { ApprovalAction, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateUniqueReferralCode } from '../common/referral-code';
import { AiService } from '../ai/ai.service';
import { ConversationTurnDto } from '../ai/dto/concierge-message.dto';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { CasesService } from '../cases/cases.service';
import { parseCaseApprovalButtonId } from './case-approval-buttons';

/**
 * Section 12 P1 "WhatsApp AI integration" — Section 7.2's conversation
 * flow, over WhatsApp instead of the web chat widget. Reuses AiService's
 * converse() exactly as the web client does; the only thing this module
 * adds is resolving a phone number to a customer identity and persisting
 * conversation history server-side (WhatsAppThread), since there's no
 * browser to hold it between webhook calls.
 *
 * Outbound (WhatsappSenderService) is wired to a real provider, Zavu
 * (docs.zavu.dev). Inbound (WhatsappWebhookGuard, InboundMessageDto) is
 * still a stand-in pending confirmation of Zavu's exact webhook signature
 * algorithm — see WhatsappWebhookGuard's comment for why that isn't
 * guessed at.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly aiService: AiService,
    private readonly sender: WhatsappSenderService,
    private readonly casesService: CasesService,
  ) {}

  async handleInboundMessage(rawFrom: string, body: string, interactiveReplyId?: string) {
    const phone = this.normalizePhone(rawFrom);
    const { user, thread } = await this.resolveThread(phone);

    // Platform Expansion PRD §6.1 "Deeper WhatsApp-first case approval" —
    // a button reply short-circuits straight to the case action instead
    // of going through the AI concierge; an unrecognised button id (e.g.
    // stale, or from a different feature) falls through to the normal
    // conversational flow below rather than erroring.
    if (interactiveReplyId) {
      const parsed = parseCaseApprovalButtonId(interactiveReplyId);
      if (parsed) {
        return this.handleCaseApprovalReply(user, phone, parsed.action, parsed.caseId);
      }
    }

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

  /** Platform Expansion PRD §6.1 — a tapped Approve/Request-changes
   * button, routed straight to CasesService.recordApproval instead of
   * the AI concierge. The caseId travels inside the button id (see
   * case-approval-buttons.ts), so it's never trusted blindly: this
   * re-derives the same ownership check CaseAccessGuard enforces on the
   * web path (CUSTOMER must own the case) before acting on it — a
   * caseId embedded in an inbound webhook payload is exactly the kind of
   * input that must never be trusted without that check. */
  private async handleCaseApprovalReply(user: User, phone: string, action: ApprovalAction, caseId: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      select: { caseNumber: true, customer: { select: { userId: true } } },
    });

    if (!serviceCase || serviceCase.customer.userId !== user.id) {
      const sendResult = await this.sender.sendMessage(phone, "We couldn't find that request under your account.");
      return { reply: null, ...sendResult };
    }

    await this.casesService.recordApproval(
      { id: user.id, role: Role.CUSTOMER, email: user.email },
      caseId,
      action,
    );

    await this.audit.record({
      caseId,
      actorId: user.id,
      actorType: 'user',
      action: 'whatsapp.case_approval_button',
      metadata: { approvalAction: action },
    });

    const confirmationText =
      action === ApprovalAction.APPROVED
        ? `Thanks — you've approved the report for ${serviceCase.caseNumber}. We'll take it from here.`
        : `Got it — we've flagged ${serviceCase.caseNumber} for additional work. A team member will follow up.`;

    const sendResult = await this.sender.sendMessage(phone, confirmationText);
    return { reply: confirmationText, ...sendResult };
  }

  /** Zavu's webhook payloads carry a plain E.164 number in `data.from` —
   * this strips a "whatsapp:"-style prefix only in case the still-
   * placeholder InboundMessageDto ever gets fed one manually (e.g. from a
   * different BSP's raw webhook format during testing). No-op on real
   * Zavu input. */
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
