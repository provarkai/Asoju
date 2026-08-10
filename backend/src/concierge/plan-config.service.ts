import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipPlan, MembershipPlanConfig } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UpdatePlanConfigDto } from './dto/update-plan-config.dto';

export interface MembershipPlanConfigView {
  plan: MembershipPlan;
  priceUsd: number;
  scGrantUsd: number;
  discountPercent: number;
  eligibleRequestsPerMonth: number;
  updatedAt: Date;
}

/**
 * P0 UX Spec "Admin Screen — Pricing Configuration" — the DB-backed
 * replacement for the MEMBERSHIP_PLANS code constant this shipped with
 * initially. This is the one place plan pricing/benefits are read or
 * changed; everything else (ConciergeService.subscribe, MembershipService.
 * previewBenefit, SubscriptionBillingService's renewal grant) calls
 * getConfig() rather than touching the table directly.
 *
 * Deliberately NOT consulted for anything already locked onto a
 * Subscription row — `priceUsd`/`fxRate`/`amount` there stay frozen at
 * subscribe/renewal time (billing continuity: a price change shouldn't
 * retroactively alter what an existing member pays this period). Only
 * `discountPercent`/`scGrantUsd`/`eligibleRequestsPerMonth` are read live
 * from here at quote-time and renewal-time.
 */
@Injectable()
export class PlanConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toView(row: MembershipPlanConfig): MembershipPlanConfigView {
    return {
      plan: row.plan,
      priceUsd: Number(row.priceUsd),
      scGrantUsd: Number(row.scGrantUsd),
      discountPercent: Number(row.discountPercent),
      eligibleRequestsPerMonth: row.eligibleRequestsPerMonth,
      updatedAt: row.updatedAt,
    };
  }

  /** Seeded by migration for both plans — a missing row means the
   * migration/seed didn't run, which is a deployment problem worth
   * surfacing loudly rather than silently falling back to made-up numbers. */
  async getConfig(plan: MembershipPlan): Promise<MembershipPlanConfigView> {
    const row = await this.prisma.membershipPlanConfig.findUnique({ where: { plan } });
    if (!row) throw new NotFoundException(`No pricing configured for plan ${plan}`);
    return this.toView(row);
  }

  /** Customer-facing plan picker (P0 UX Spec "Customer Screen — Membership")
   * and the admin pricing screen both read this — broadly accessible, no
   * commercial reason to hide current list pricing from a logged-in user. */
  async listConfigs(): Promise<MembershipPlanConfigView[]> {
    const rows = await this.prisma.membershipPlanConfig.findMany({ orderBy: { plan: 'asc' } });
    return rows.map((r) => this.toView(r));
  }

  /** Finance/Admin only (enforced by the controller's @Roles) — every
   * change is audited with before/after values. Never touches any
   * already-created Subscription row: existing members keep the
   * priceUsd/fxRate/amount they locked in, and only pick up new
   * discount/SC/allowance figures at their next quote or renewal. */
  async updateConfig(actor: AuthenticatedUser, plan: MembershipPlan, dto: UpdatePlanConfigDto): Promise<MembershipPlanConfigView> {
    const existing = await this.prisma.membershipPlanConfig.findUnique({ where: { plan } });
    if (!existing) throw new NotFoundException(`No pricing configured for plan ${plan}`);

    if (
      dto.priceUsd === undefined &&
      dto.scGrantUsd === undefined &&
      dto.discountPercent === undefined &&
      dto.eligibleRequestsPerMonth === undefined
    ) {
      throw new BadRequestException('At least one field must be provided');
    }

    const before = this.toView(existing);
    const updated = await this.prisma.membershipPlanConfig.update({
      where: { plan },
      data: {
        priceUsd: dto.priceUsd ?? undefined,
        scGrantUsd: dto.scGrantUsd ?? undefined,
        discountPercent: dto.discountPercent ?? undefined,
        eligibleRequestsPerMonth: dto.eligibleRequestsPerMonth ?? undefined,
        updatedById: actor.id,
      },
    });

    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'concierge.plan_config_updated',
      metadata: { plan, before, after: this.toView(updated) },
    });

    return this.toView(updated);
  }
}
