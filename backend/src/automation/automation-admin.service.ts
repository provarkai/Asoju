import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AutomationRuleKind, ServiceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

/**
 * docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 3's open decision #5
 * carried forward from Phase 1: backend CRUD only for the first cut, no
 * frontend admin screen yet — same resolution the pricing engine's own
 * price-book config got ("a calculator usable by staff via the API today
 * is real, incremental value... the UI is a fair follow-up ticket, not a
 * blocker").
 */
@Injectable()
export class AutomationAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createCapability(actor: AuthenticatedUser, serviceType: ServiceType, enabled = false) {
    const existing = await this.prisma.automationCapability.findUnique({ where: { serviceType } });
    if (existing) throw new ConflictException(`An automation capability for ${serviceType} already exists`);

    const capability = await this.prisma.automationCapability.create({ data: { serviceType, enabled } });
    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'automation_capability.created',
      metadata: { capabilityId: capability.id, serviceType, enabled },
    });
    return capability;
  }

  async listCapabilities() {
    return this.prisma.automationCapability.findMany({
      include: { rules: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { serviceType: 'asc' },
    });
  }

  /** The kill switch. Deliberately its own method (not folded into a
   * generic capability PATCH) so flipping it is always an explicit,
   * distinctly-audited action — same reasoning as CasesService.holdCase
   * being its own method rather than a generic status PATCH.
   * `serviceType` arrives as a raw route-param string; validated against
   * the real enum here rather than trusting the caller. */
  async setEnabled(actor: AuthenticatedUser, serviceTypeParam: string, enabled: boolean) {
    if (!Object.values(ServiceType).includes(serviceTypeParam as ServiceType)) {
      throw new BadRequestException(`Unknown service type: ${serviceTypeParam}`);
    }
    const serviceType = serviceTypeParam as ServiceType;

    const capability = await this.prisma.automationCapability.findUnique({ where: { serviceType } });
    if (!capability) throw new NotFoundException(`No automation capability configured for ${serviceType}`);

    const updated = await this.prisma.automationCapability.update({ where: { serviceType }, data: { enabled } });
    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: enabled ? 'automation_capability.enabled' : 'automation_capability.disabled',
      metadata: { capabilityId: capability.id, serviceType },
    });
    return updated;
  }

  async addRule(actor: AuthenticatedUser, capabilityId: string, kind: AutomationRuleKind, config: Record<string, unknown>, sortOrder?: number) {
    const capability = await this.prisma.automationCapability.findUnique({ where: { id: capabilityId } });
    if (!capability) throw new NotFoundException('Automation capability not found');
    this.assertValidConfigShape(kind, config);

    const rule = await this.prisma.automationRule.create({
      data: { capabilityId, kind, config: config as any, sortOrder: sortOrder ?? 0 },
    });
    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'automation_rule.created',
      metadata: { ruleId: rule.id, capabilityId, kind, config },
    });
    return rule;
  }

  async listRules(capabilityId: string) {
    return this.prisma.automationRule.findMany({ where: { capabilityId }, orderBy: { sortOrder: 'asc' } });
  }

  async removeRule(actor: AuthenticatedUser, ruleId: string) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException('Automation rule not found');

    await this.prisma.automationRule.delete({ where: { id: ruleId } });
    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'automation_rule.removed',
      metadata: { ruleId, capabilityId: rule.capabilityId },
    });
    return { removed: true };
  }

  /** A malformed rule config would fail silently at evaluation time
   * (automation-evaluator.ts treats an unexpected shape as an empty
   * fields/keywords list — never crashes, but also never does what the
   * admin who created it thought it would) — reject it here instead,
   * before it's ever stored. */
  private assertValidConfigShape(kind: AutomationRuleKind, config: Record<string, unknown>): void {
    if (kind === AutomationRuleKind.REQUIRED_FIELDS) {
      const fields = config.fields;
      if (!Array.isArray(fields) || fields.length === 0 || !fields.every((f) => typeof f === 'string')) {
        throw new BadRequestException('REQUIRED_FIELDS rule config needs a non-empty array of field-name strings ("fields")');
      }
    }
    if (kind === AutomationRuleKind.BLOCKED_KEYWORDS) {
      const keywords = config.keywords;
      if (!Array.isArray(keywords) || keywords.length === 0 || !keywords.every((k) => typeof k === 'string')) {
        throw new BadRequestException('BLOCKED_KEYWORDS rule config needs a non-empty array of keyword strings ("keywords")');
      }
    }
  }
}
