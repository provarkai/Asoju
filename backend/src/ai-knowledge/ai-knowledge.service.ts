import { Injectable, NotFoundException } from '@nestjs/common';
import { AiKnowledgeCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PricingEngineService } from '../pricing-engine/pricing-engine.service';
import { CreateAiKnowledgeEntryDto } from './dto/create-ai-knowledge-entry.dto';
import { UpdateAiKnowledgeEntryDto } from './dto/update-ai-knowledge-entry.dto';

const CATEGORY_ORDER: AiKnowledgeCategory[] = [
  AiKnowledgeCategory.PRICING,
  AiKnowledgeCategory.SERVICE_INFO,
  AiKnowledgeCategory.POLICY,
  AiKnowledgeCategory.FAQ,
  AiKnowledgeCategory.GENERAL,
];

/**
 * "There should be a way we tell/teach the AI the prices and customer
 * service, and deep knowledge of what we are doing." CRUD here is
 * backend-only for the first cut, same resolved precedent as
 * AutomationAdminService and the pricing engine's own admin controller —
 * a calculator/editor usable by staff via the API today is real,
 * incremental value; a dedicated admin screen is a fair follow-up, not a
 * blocker.
 *
 * buildContextBlock() is the actual "teaching" mechanism: it is called
 * fresh on every AI turn (never baked into system-prompt.ts, which stays
 * the frozen, deliberately-reviewed behavioural contract) and combines
 * staff-authored knowledge with the live pricing catalog, so an edit here
 * or a price change in the pricing engine is reflected in the AI's very
 * next reply with nothing else to keep in sync.
 */
@Injectable()
export class AiKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricingEngine: PricingEngineService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateAiKnowledgeEntryDto) {
    const entry = await this.prisma.aiKnowledgeEntry.create({
      data: {
        category: dto.category,
        title: dto.title,
        content: dto.content,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'ai_knowledge.created',
      metadata: { entryId: entry.id, category: entry.category, title: entry.title },
    });
    return entry;
  }

  async list() {
    return this.prisma.aiKnowledgeEntry.findMany({
      orderBy: [{ category: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateAiKnowledgeEntryDto) {
    const existing = await this.prisma.aiKnowledgeEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Knowledge entry not found');

    const entry = await this.prisma.aiKnowledgeEntry.update({
      where: { id },
      data: {
        category: dto.category ?? undefined,
        title: dto.title ?? undefined,
        content: dto.content ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
    });
    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'ai_knowledge.updated',
      metadata: { entryId: entry.id, category: entry.category, isActive: entry.isActive },
    });
    return entry;
  }

  // Soft-disable via update({isActive: false}) is the normal retirement
  // path (keeps the audit trail, matches AutomationCapability's own
  // convention) — this hard-delete exists for genuine mistakes (wrong
  // content published, nothing worth keeping a record of).
  async remove(actor: AuthenticatedUser, id: string) {
    const existing = await this.prisma.aiKnowledgeEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Knowledge entry not found');

    await this.prisma.aiKnowledgeEntry.delete({ where: { id } });
    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'ai_knowledge.deleted',
      metadata: { entryId: id, category: existing.category, title: existing.title },
    });
  }

  /**
   * Formats every active entry plus the live pricing catalog into one
   * text block for the AI to ground replies in. Returns null when there
   * is nothing real to say (no active entries and no active price book)
   * so callers can skip adding an empty system message — same "don't
   * invent content" discipline as PricingEngineService returning null.
   */
  async buildContextBlock(): Promise<string | null> {
    const [entries, pricingSummary] = await Promise.all([
      this.prisma.aiKnowledgeEntry.findMany({ where: { isActive: true } }),
      this.pricingEngine.getActivePricingCatalogSummary(),
    ]);

    if (entries.length === 0 && !pricingSummary) return null;

    const sections: string[] = [];
    for (const category of CATEGORY_ORDER) {
      const inCategory = entries.filter((e) => e.category === category);
      if (inCategory.length === 0) continue;
      sections.push(
        `## ${category.replace(/_/g, ' ')}\n` + inCategory.map((e) => `- ${e.title}: ${e.content}`).join('\n'),
      );
    }
    if (pricingSummary) {
      sections.push(`## LIVE PRICING\n${pricingSummary}`);
    }

    return [
      'BUSINESS KNOWLEDGE (staff-maintained — treat as authoritative fact about ASOJU; if something is not covered here, say you are not certain rather than guessing):',
      ...sections,
    ].join('\n\n');
  }
}
