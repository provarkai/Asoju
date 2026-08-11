import { Injectable, Logger } from '@nestjs/common';
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

// -- OpenRouter transport ------------------------------------------------
// The model provider is OpenRouter (openrouter.ai) — a single OpenAI-
// compatible endpoint in front of many underlying models, chosen over a
// direct Anthropic SDK dependency. Same raw-fetch integration shape as
// every other external provider in this repo (Paystack, Resend, Zavu) —
// no vendor SDK, one small typed wrapper around the HTTP contract.
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ChatCompletionResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { function: { name: string; arguments: string } }[];
    };
  }[];
}

// OpenAI/OpenRouter tool-calling shape for the same structured turn
// contract the Concierge has always used — only the transport changed,
// not what's being asked for or how the response is validated below.
const SUBMIT_TURN_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'submit_turn',
    description:
      'Submit this conversational turn: the visible reply plus structured data for CRM logging. Always respond by calling this tool — never write raw JSON into the reply text.',
    parameters: {
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
  },
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly configured: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    this.configured = Boolean(process.env.OPENROUTER_API_KEY);
    if (!this.configured) {
      this.logger.warn('OPENROUTER_API_KEY not set — AI Concierge endpoint will return an error until configured.');
    }
  }

  private async chatCompletion(params: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    toolChoice?: { type: 'function'; function: { name: string } };
  }): Promise<ChatCompletionResponse> {
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.AI_CONCIERGE_MODEL ?? 'anthropic/claude-sonnet-5',
        max_tokens: 1024,
        messages: params.messages,
        ...(params.tools ? { tools: params.tools } : {}),
        ...(params.toolChoice ? { tool_choice: params.toolChoice } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenRouter request failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<ChatCompletionResponse>;
  }

  /**
   * Section 7 — AI Diaspora Concierge conversational turn. The LLM never
   * writes to the database directly (Section 7.6): it returns a structured
   * ACTION via forced tool-use, which this method validates before doing
   * anything with it. Deterministic scoring (Section 7.4) runs in plain
   * code, never as another LLM call.
   */
  async converse(user: AuthenticatedUser, dto: ConciergeMessageDto) {
    if (!this.configured) {
      throw new Error('AI Concierge is not configured (missing OPENROUTER_API_KEY).');
    }
    if (user.role !== Role.CUSTOMER) {
      throw new Error('AI Concierge is customer-facing only.');
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: CONCIERGE_SYSTEM_PROMPT },
      ...(dto.history ?? []).map((turn) => ({ role: turn.role, content: turn.content }) as ChatMessage),
      { role: 'user', content: dto.message },
    ];

    const response = await this.chatCompletion({
      messages,
      tools: [SUBMIT_TURN_TOOL],
      toolChoice: { type: 'function', function: { name: 'submit_turn' } },
    });

    const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];
    let turn: ConciergeTurnResult;
    try {
      if (!toolCall) throw new Error('no tool call');
      turn = JSON.parse(toolCall.function.arguments) as ConciergeTurnResult;
    } catch {
      throw new Error('AI Concierge did not return a structured turn.');
    }

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
    if (!this.configured) {
      throw new Error('AI Assistant is not configured (missing OPENROUTER_API_KEY).');
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

    const messages: ChatMessage[] = [
      { role: 'system', content: PERSONAL_ASSISTANT_SYSTEM_PROMPT },
      { role: 'user', content: `CONTEXT (this customer's own account — nothing outside this exists):\n${JSON.stringify(context)}` },
      { role: 'assistant', content: "Understood — I'll answer only from that context." },
      ...(dto.history ?? []).map((turn) => ({ role: turn.role, content: turn.content }) as ChatMessage),
      { role: 'user', content: dto.message },
    ];

    const response = await this.chatCompletion({ messages });

    const reply = response.choices?.[0]?.message?.content ?? "Sorry, I couldn't put together a reply — please try again.";

    await this.audit.record({
      actorId: user.id,
      actorType: 'ai',
      action: 'ai.assistant_turn',
      metadata: { promptSummary: dto.message.slice(0, 500) },
    });

    return { reply };
  }
}
