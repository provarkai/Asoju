import { Injectable } from '@nestjs/common';
import { CaseStatus, PaymentStatus, QcOutcome } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Section 12 P1 "advanced analytics" — a working subset of Section 13's
 * success metrics (Customer/Operations/Financial/Trust categories). Not
 * exhaustive (SLA compliance and AI escalation-accuracy need event types
 * this MVP doesn't emit yet) but every number here is real, computed from
 * the same tables the rest of the app writes to — nothing pre-aggregated
 * or cached, so it's always current.
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
      },
      trust: {
        avgRating: ratingAgg._avg.stars,
        ratingCount: ratingAgg._count._all,
      },
      operations: {
        totalQcReviews,
        qcOutcomeCounts,
        reworkRate,
        exceptionsRaised: exceptionCount,
        incidentsBySeverity: Object.fromEntries(incidentsBySeverity.map((i) => [i.severity, i._count._all])),
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
