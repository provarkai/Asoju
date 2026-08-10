import { Injectable } from '@nestjs/common';
import { CaseStatus, PaymentStatus, QcOutcome } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Section 12 P1 "advanced analytics" — a working subset of Section 13's
 * success metrics (Customer/Operations/Financial/Trust categories). Not
 * exhaustive (AI escalation-accuracy needs an event type this MVP doesn't
 * emit yet) but every number here is real, computed from the same tables
 * the rest of the app writes to — nothing pre-aggregated or cached, so
 * it's always current. overdueCases/unownedActiveCases (P0 Tech Platform
 * §9) and contribution/contributionMargin (P0 Tech Platform §33) close
 * what used to be this file's own admitted gap.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const [
      totalCustomers,
      casesByCustomer,
      totalCases,
      casesByStatus,
      paidPayments,
      acceptedQuotes,
      ratingAgg,
      incidentsBySeverity,
      qcAuditEvents,
      exceptionCount,
      overdueCases,
      unownedActiveCases,
      directCosts,
    ] = await Promise.all([
      this.prisma.customer.count(),
      this.prisma.serviceCase.groupBy({ by: ['customerId'], _count: { _all: true } }),
      this.prisma.serviceCase.count(),
      this.prisma.serviceCase.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.payment.findMany({
        where: { status: PaymentStatus.PAID },
        select: { amount: true, currency: true },
      }),
      this.prisma.quote.findMany({
        where: { acceptedAt: { not: null } },
        select: { amount: true },
      }),
      this.prisma.rating.aggregate({ _avg: { stars: true }, _count: { _all: true } }),
      this.prisma.incident.groupBy({ by: ['severity'], _count: { _all: true } }),
      this.prisma.auditEvent.findMany({
        where: { action: 'case.qc_performed' },
        select: { metadata: true },
      }),
      this.prisma.caseRiskFlag.count(),
      // P0 Tech Platform §9 "Case Control Requirements" — overdue/unowned
      // is the whole point of tracking slaTargetAt/ownerUserId at all; the
      // Ops queue computes this per-row too, this is the org-wide count.
      this.prisma.serviceCase.count({
        where: {
          slaTargetAt: { lt: new Date() },
          status: { notIn: [CaseStatus.COMPLETED, CaseStatus.CLOSED] },
        },
      }),
      this.prisma.serviceCase.count({
        where: { ownerUserId: null, status: { notIn: [CaseStatus.COMPLETED, CaseStatus.CLOSED] } },
      }),
      // P0 Tech Platform §33 "Financial & Analytics Requirements" —
      // Contribution = Revenue - Direct Case Costs.
      this.prisma.directCost.findMany({ select: { amount: true, currency: true } }),
    ]);

    const customersWithCases = casesByCustomer.length;
    const repeatCustomers = casesByCustomer.filter((c) => c._count._all > 1).length;

    const statusCounts = Object.fromEntries(casesByStatus.map((s) => [s.status, s._count._all])) as Record<
      CaseStatus,
      number
    >;
    const completed = (statusCounts.COMPLETED ?? 0) + (statusCounts.CLOSED ?? 0);

    const revenueByCurrency: Record<string, number> = {};
    for (const p of paidPayments) {
      revenueByCurrency[p.currency] = (revenueByCurrency[p.currency] ?? 0) + Number(p.amount);
    }
    const avgCaseValue =
      acceptedQuotes.length > 0
        ? acceptedQuotes.reduce((sum, q) => sum + Number(q.amount), 0) / acceptedQuotes.length
        : null;

    // P0 Tech Platform §33 — "Contribution = Revenue - Direct Case Costs;
    // Contribution Margin % = Contribution / Revenue." Computed per
    // currency, same bucketing as revenueByCurrency, rather than summing
    // mismatched currencies together.
    const directCostsByCurrency: Record<string, number> = {};
    for (const c of directCosts) {
      directCostsByCurrency[c.currency] = (directCostsByCurrency[c.currency] ?? 0) + Number(c.amount);
    }
    const contributionByCurrency: Record<string, number> = {};
    const contributionMarginByCurrency: Record<string, number | null> = {};
    for (const currency of new Set([...Object.keys(revenueByCurrency), ...Object.keys(directCostsByCurrency)])) {
      const revenue = revenueByCurrency[currency] ?? 0;
      const directCost = directCostsByCurrency[currency] ?? 0;
      const contribution = revenue - directCost;
      contributionByCurrency[currency] = contribution;
      contributionMarginByCurrency[currency] = revenue > 0 ? contribution / revenue : null;
    }

    const qcOutcomeCounts: Record<string, number> = {};
    for (const event of qcAuditEvents) {
      const outcome = (event.metadata as { outcome?: QcOutcome } | null)?.outcome;
      if (outcome) qcOutcomeCounts[outcome] = (qcOutcomeCounts[outcome] ?? 0) + 1;
    }
    const totalQcReviews = qcAuditEvents.length;
    const reworkRate = totalQcReviews > 0 ? (qcOutcomeCounts.REWORK ?? 0) / totalQcReviews : null;

    return {
      customers: {
        total: totalCustomers,
        withCases: customersWithCases,
        repeatCustomers,
        repeatRate: customersWithCases > 0 ? repeatCustomers / customersWithCases : null,
      },
      cases: {
        total: totalCases,
        byStatus: statusCounts,
        completionRate: totalCases > 0 ? completed / totalCases : null,
      },
      financial: {
        revenueByCurrency,
        avgCaseValue,
        acceptedQuoteCount: acceptedQuotes.length,
        directCostsByCurrency,
        contributionByCurrency,
        contributionMarginByCurrency,
      },
      trust: {
        avgRating: ratingAgg._avg.stars,
        ratingCount: ratingAgg._count._all,
      },
      operations: {
        totalQcReviews,
        qcOutcomeCounts,
        reworkRate,
        overdueCases,
        unownedActiveCases,
        exceptionsRaised: exceptionCount,
        incidentsBySeverity: Object.fromEntries(incidentsBySeverity.map((i) => [i.severity, i._count._all])),
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
