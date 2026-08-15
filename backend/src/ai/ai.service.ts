import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AiEscalation, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CONCIERGE_SYSTEM_PROMPT, PERSONAL_ASSISTANT_SYSTEM_PROMPT } from './system-prompt';
import { scoreLead } from './scoring';
import { ConciergeMessageDto } from './dto/concierge-message.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

interface ConciergeTurnResult {
  reply_text: string;
  data_collected: {
    service_type: string | null;
    location: string | null;
    scope_detail: string | null;
    timeline: 'immediate' | 'near_term' | 'exploring' | null;
    payment_method: 'cash_ready' | 'diaspora_plan' | 'financing' | null;
  };
  escalate: 'none' | 'human_requested' | 'vip' | 'frustration' | 'legal_question';
  conversation_complete: boolean;
  engagement_subscore: number;
}

const ESCALATION_MAP: Record<ConciergeTurnResult['escalate'], AiEscalation> = {
  none: AiEscalation.NONE,
  human_requested: AiEscalation.HUMAN_REQUESTED,
  vip: AiEscalation.VIP,
  frustration: AiEscalation.FRUSTRATION,
  legal_question: AiEscalation.LEGAL_QUESTION,
};

// A conservative default price band (NGN) for the deterministic scoring
// model (Section 7.4) until per-service pricing config lands (Section 6:
// "Every service must have a standard specification ... pricing method").
const DEFAULT_SERVICE_PRICE_BAND_NGN = 150_000;

const SUBMIT_TURN_TOOL: Anthropic.Tool = {
  name: 'submit_turn',
  description:
    'Submit this conversational turn: the visible reply plus structured data for CRM logging. Always respond by calling this tool — never write raw JSON into the reply text.',
  input_schema: {
    type: 'object',
    properties: {
      reply_text: { type: 'string', description: 'The message to show the customer.' },
      data_collected: {
        type: 'object',
        properties: {
          service_type: { type: ['string', 'null'] },
          location: { type: ['string', 'null'] },
          scope_detail: { type: ['string', 'null'] },
          timeline: { type: ['string', 'null'], enum: ['immediate', 'near_term', 'exploring', null] },
          payment_method: {
            type: ['string', 'null'],
            enum: ['cash_ready', 'diaspora_plan', 'financing', null],
          },
        },
        required: ['service_type', 'location', 'scope_detail', 'timeline', 'payment_method'],
      },
      escalate: {
        type: 'string',
        enum: ['none', 'human_requested', 'vip', 'frustration', 'legal_question'],
      },
      conversation_complete: { type: 'boolean' },
      engagement_subscore: { type: 'integer', minimum: 0, maximum: 15 },
    },
    required: ['reply_text', 'data_collected', 'escalate', 'conversation_complete', 'engagement_subscore'],
  },
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    if (!this.client) {
      this.logger.warn('ANTHROPIC_API_KEY not set — AI Concierge endpoint will return an error until configured.');
    }
  }

  /**
   * Section 7 — AI Diaspora Concierge conversational turn. The LLM never
   * writes to the database directly (Section 7.6): it returns a structured
   * ACTION via forced tool-use, which this method validates before doing
   * anything with it. Deterministic scoring (Section 7.4) runs in plain
   * code, never as another LLM call.
   */
  /** The actual Anthropic call + forced-tool-use validation, shared by
   * converse() (authenticated, persists a ServiceRequest on completion)
   * and demoConverse() (public landing-page preview, persists nothing).
   * Keeping this the one place that talks to Anthropic for the intake
   * Concierge means both surfaces stay behaviorally identical — same
   * system prompt, same forced structured output — and only differ in
   * what they do with the result. */
  private async runConciergeTurn(dto: ConciergeMessageDto): Promise<ConciergeTurnResult> {
    if (!this.client) {
      throw new Error('AI Concierge is not configured (missing ANTHROPIC_API_KEY).');
    }

    const messages: Anthropic.MessageParam[] = [
      ...(dto.history ?? []).map((turn) => ({ role: turn.role, content: turn.content }) as Anthropic.MessageParam),
      { role: 'user', content: dto.message },
    ];

    const response = await this.client.messages.create({
      model: process.env.AI_CONCIERGE_MODEL ?? 'claude-sonnet-5',
      max_tokens: 1024,
      system: CONCIERGE_SYSTEM_PROMPT,
      messages,
      tools: [SUBMIT_TURN_TOOL],
      tool_choice: { type: 'tool', name: 'submit_turn' },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUse) {
      throw new Error('AI Concierge did not return a structured turn.');
    }
    return toolUse.input as ConciergeTurnResult;
  }

  async converse(user: AuthenticatedUser, dto: ConciergeMessageDto) {
    if (user.role !== Role.CUSTOMER) {
      throw new Error('AI Concierge is customer-facing only.');
    }

    const turn = await this.runConciergeTurn(dto);
    const escalation = ESCALATION_MAP[turn.escalate] ?? AiEscalation.NONE;

    const interaction = await this.prisma.aiInteraction.create({
      data: {
        channel: 'web',
        actionLevel: 'ASSIST',
        promptSummary: dto.message.slice(0, 500),
        dataCollected: turn.data_collected as any,
        engagementSubscore: turn.engagement_subscore,
        escalation,
        conversationComplete: turn.conversation_complete,
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'ai',
      action: 'ai.concierge_turn',
      metadata: { aiInteractionId: interaction.id, escalate: turn.escalate, conversationComplete: turn.conversation_complete },
    });

    let serviceRequestId: string | null = null;
    if (turn.conversation_complete) {
      serviceRequestId = await this.completeIntake(user, turn, interaction.id);
    }

    return {
      reply: turn.reply_text,
      escalate: turn.escalate,
      conversationComplete: turn.conversation_complete,
      serviceRequestId,
    };
  }

  /**
   * Public landing-page preview of the AI Concierge (asoju-app-main
   * conversion) — a visitor trying it before signing up. Deliberately
   * thin next to converse(): no user, so no ServiceRequest, no
   * AiInteraction row (nothing real to attach it to yet), no lead
   * scoring. Just the conversational capture + reply, so the demo feels
   * alive without inventing a second, anonymous intake pipeline that
   * writes real records. When the conversation completes, the frontend
   * is expected to route the visitor to sign-in — actual case creation
   * stays exactly where it already was: authenticated only, staff
   * quotes it from there like every other request (this app never lets
   * the AI generate a binding quote — see cases/commerce README notes on
   * why quotes are human-issued).
   */
  async demoConverse(dto: ConciergeMessageDto) {
    const turn = await this.runConciergeTurn(dto);
    return {
      reply: turn.reply_text,
      escalate: turn.escalate,
      conversationComplete: turn.conversation_complete,
    };
  }

  /**
   * Tool-based AI action, Section 7.6: creates a ServiceRequest (never a
   * ServiceCase directly — that conversion is a separate, human/deterministic
   * step, per vertical slice 1) once the concierge conversation completes.
   */
  private async completeIntake(
    user: AuthenticatedUser,
    turn: ConciergeTurnResult,
    aiInteractionId: string,
  ): Promise<string> {
    const customer = await this.prisma.customer.findUnique({ where: { userId: user.id } });
    if (!customer) {
      this.logger.warn(`AI Concierge completed intake for user ${user.id} with no customer profile`);
      throw new Error('No customer profile for this user');
    }

    const { score, tag } = scoreLead({
      statedValue: null, // Section 7.4 sub-signal, not yet collected by this conversational flow
      servicePriceBand: DEFAULT_SERVICE_PRICE_BAND_NGN,
      timeline: turn.data_collected.timeline,
      paymentMethod: turn.data_collected.payment_method,
      engagementSubscore: turn.engagement_subscore,
    });

    const request = await this.prisma.serviceRequest.create({
      data: {
        customerId: customer.id,
        rawDescription: turn.data_collected.scope_detail ?? turn.reply_text,
        location: turn.data_collected.location,
        channel: 'web',
        leadScore: score,
        leadTag: tag,
        aiInteractionId,
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'ai',
      action: 'ai.service_request_created',
      metadata: { serviceRequestId: request.id, leadScore: score, leadTag: tag },
    });

    return request.id;
  }

  /**
   * Section 12 P2 "personal AI assistant" — grounded read-only Q&A for an
   * existing customer over their own portfolio. Unlike converse() above,
   * this makes NO tool call and writes NOTHING to the case/commerce
   * pipeline: there is no action for it to take, so there is nothing to
   * validate before acting on it (the reason converse() forces tool-use).
   * Fails closed exactly like the intake Concierge without a configured key.
   */
  async assistantReply(user: AuthenticatedUser, dto: ConciergeMessageDto) {
    if (!this.client) {
      throw new Error('AI Assistant is not configured (missing ANTHROPIC_API_KEY).');
    }
    if (user.role !== Role.CUSTOMER) {
      throw new Error('AI Assistant is customer-facing only.');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { userId: user.id },
      include: {
        serviceCases: {
          orderBy: { createdAt: 'desc' },
          select: { caseNumber: true, serviceType: true, status: true, tier: true, createdAt: true },
        },
        subscriptions: { orderBy: { startedAt: 'desc' }, take: 1 },
        beneficiaries: { select: { fullName: true, relationship: true } },
        properties: { select: { address: true, city: true, state: true } },
        assets: { select: { assetType: true, location: true } },
      },
    });
    if (!customer) throw new Error('No customer profile for this user');

    const context = {
      customer_name: customer.fullName,
      cases: customer.serviceCases.map((c) => ({
        case_number: c.caseNumber,
        service_type: c.serviceType,
        status: c.status,
        tier: c.tier,
        opened: c.createdAt.toISOString().slice(0, 10),
      })),
      subscription: customer.subscriptions[0]
        ? { tier: customer.subscriptions[0].tier, status: customer.subscriptions[0].status }
        : null,
      beneficiaries: customer.beneficiaries,
      properties: customer.properties,
      assets: customer.assets,
    };

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: `CONTEXT (this customer's own account — nothing outside this exists):\n${JSON.stringify(context)}` },
      { role: 'assistant', content: "Understood — I'll answer only from that context." },
      ...(dto.history ?? []).map((turn) => ({ role: turn.role, content: turn.content }) as Anthropic.MessageParam),
      { role: 'user', content: dto.message },
    ];

    const response = await this.client.messages.create({
      model: process.env.AI_CONCIERGE_MODEL ?? 'claude-sonnet-5',
      max_tokens: 1024,
      system: PERSONAL_ASSISTANT_SYSTEM_PROMPT,
      messages,
    });

    const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
    const reply = textBlock?.text ?? "Sorry, I couldn't put together a reply — please try again.";

    await this.audit.record({
      actorId: user.id,
      actorType: 'ai',
      action: 'ai.assistant_turn',
      metadata: { promptSummary: dto.message.slice(0, 500) },
    });

    return { reply };
  }
}
