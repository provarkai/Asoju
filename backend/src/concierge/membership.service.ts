import { Injectable } from '@nestjs/common';
import { CaseTier, Prisma, Subscription, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScLedgerService } from './sc-ledger.service';
import { PlanConfigService } from './plan-config.service';

const BILLING_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface QuoteBenefitPreview {
  subscriptionId: string;
  discountPercent: number;
  discountAmount: number;
  scAppliedNgn: number;
  finalAmount: number;
}

/**
 * P0 Technical Build Spec Section 17 "Membership Engine" — "Benefits
 * evaluated server-side... Usage recorded against cases." This is the one
 * place that decides whether/how much a Priority or Premium benefit
 * applies to a given quote; CommerceService calls it, never computes a
 * discount itself.
 */
@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scLedger: ScLedgerService,
    private readonly planConfig: PlanConfigService,
  ) {}

  async getActiveSubscription(customerId: string): Promise<Subscription | null> {
    return this.prisma.subscription.findFirst({
      where: { customerId, status: SubscriptionStatus.ACTIVE },
    });
  }

  /** Start of the subscription's current billing period — renewsAt is
   * always "next" renewal, so the current period started one cycle
   * before that (or at startedAt, before the first renewal has run). */
  private periodStart(subscription: Pick<Subscription, 'renewsAt' | 'startedAt'>): Date {
    if (subscription.renewsAt) return new Date(subscription.renewsAt.getTime() - BILLING_PERIOD_MS);
    return subscription.startedAt;
  }

  /** H-10 "Eligible request allowance tracking" — a quote counts against
   * the monthly allowance the moment membership discount was applied to
   * it, whether or not the customer goes on to accept it (matching "up
   * to N eligible requests/month" as a request-count ceiling, not a
   * spend ceiling). */
  async getEligibleUsageThisPeriod(subscription: Subscription): Promise<number> {
    return this.prisma.quote.count({
      where: {
        subscriptionId: subscription.id,
        createdAt: { gte: this.periodStart(subscription) },
        discountAmount: { not: null },
      },
    });
  }

  /**
   * Read-only projection at quote-creation time (CommerceService.createQuote)
   * — writes nothing to the SC ledger. Returns null when no benefit
   * applies: no active subscription, the case isn't CONCIERGE tier, or
   * the monthly eligible-request allowance is already used up this period.
   */
  async previewBenefit(customerId: string, caseTier: CaseTier, baseAmountNgn: number): Promise<QuoteBenefitPreview | null> {
    if (caseTier !== CaseTier.CONCIERGE) return null;
    const subscription = await this.getActiveSubscription(customerId);
    if (!subscription) return null;

    const plan = await this.planConfig.getConfig(subscription.plan);
    const used = await this.getEligibleUsageThisPeriod(subscription);
    if (used >= plan.eligibleRequestsPerMonth) return null;

    const discountAmount = Math.round(baseAmountNgn * (plan.discountPercent / 100));
    const afterDiscount = baseAmountNgn - discountAmount;

    const availableScUsd = await this.scLedger.getBalanceUsd(subscription.id);
    const fxRate = Number(subscription.fxRate);
    const availableScNgn = availableScUsd * fxRate;
    const scAppliedNgn = Math.max(0, Math.min(availableScNgn, afterDiscount));
    const finalAmount = Math.max(0, Math.round(afterDiscount - scAppliedNgn));

    return {
      subscriptionId: subscription.id,
      discountPercent: plan.discountPercent,
      discountAmount,
      scAppliedNgn: Math.round(scAppliedNgn),
      finalAmount,
    };
  }

  /**
   * Called only from CommerceService.acceptQuote — the point of real
   * commitment, not the draft/preview stage. Re-validates against the
   * *current* SC balance and subscription status rather than trusting the
   * quote's stored projection (both can have moved since createQuote), and
   * only here does an actual DEBIT ledger entry get written. Returns the
   * corrected payable amount; `adjusted` tells the caller whether it
   * differs from the quote's originally displayed amount (e.g. SC ran out
   * to another case in the meantime), which is logged/audited rather than
   * silently charged.
   */
  async commitBenefit(quote: {
    id: string;
    caseId: string;
    subscriptionId: string | null;
    baseAmount: Prisma.Decimal | null;
    nonServiceFeeAmount: Prisma.Decimal | null;
    discountAmount: Prisma.Decimal | null;
    scAppliedNgn: Prisma.Decimal | null;
    amount: Prisma.Decimal;
  }): Promise<{ finalAmount: number; adjusted: boolean }> {
    if (!quote.subscriptionId) return { finalAmount: Number(quote.amount), adjusted: false };

    const subscription = await this.prisma.subscription.findUnique({ where: { id: quote.subscriptionId } });
    // P0 Technical Build Spec Section 16 — the discount/SC only ever apply
    // to the ASOJU_SERVICE_FEE lines (baseAmount); nonServiceFeeAmount
    // (external/third-party/tax lines) is added back on top untouched,
    // same as at quote-creation time.
    const baseAmount = Number(quote.baseAmount ?? quote.amount);
    const nonServiceFeeAmount = Number(quote.nonServiceFeeAmount ?? 0);
    const discountAmount = Number(quote.discountAmount ?? 0);

    // Membership lapsed between quote creation and acceptance — the
    // discount/SC preview no longer applies; customer pays the
    // undiscounted base amount rather than silently keeping a benefit
    // they no longer hold.
    if (!subscription || subscription.status !== SubscriptionStatus.ACTIVE) {
      const finalAmount = Math.round(baseAmount) + nonServiceFeeAmount;
      return { finalAmount, adjusted: finalAmount !== Math.round(Number(quote.amount)) };
    }

    const fxRate = Number(subscription.fxRate);
    const projectedScUsd = quote.scAppliedNgn ? Number(quote.scAppliedNgn) / fxRate : 0;
    const { appliedNgn } = await this.scLedger.debit(subscription.id, projectedScUsd, {
      caseId: quote.caseId,
      quoteId: quote.id,
      fxRate,
    });

    const finalAmount = Math.max(0, Math.round(baseAmount - discountAmount - appliedNgn)) + nonServiceFeeAmount;
    const adjusted = finalAmount !== Math.round(Number(quote.amount));
    return { finalAmount, adjusted };
  }
}
