import { Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, ServiceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { classifyZone } from '../scope/pricing-zone';

/// Platform Expansion PRD §5.3 "Predictive Costing" internal tool —
/// "estimate expected direct cost before a quote is finalized, from
/// historic Assignment/DirectCost data." Same "deterministic, never
/// model-inferred" philosophy as RiskEngineService/AgentTieringService: a
/// plain historical average over DirectCost rows on this service type's
/// terminal (COMPLETED/CLOSED) cases in the same zone — no ML, nothing
/// invented. Reuses §2.2's zone classification (classifyZone) rather than
/// a second geography system, same as §5.2's regional SLA.
const MIN_SAMPLE_FOR_HIGH_CONFIDENCE = 3;

// Same terminal-status set RatingsService uses to decide a case is
// "actually finished" — direct costs recorded before that point can still
// change, so they'd skew the historical average.
const TERMINAL_STATUSES: CaseStatus[] = [CaseStatus.COMPLETED, CaseStatus.CLOSED];

export type CostConfidence = 'NONE' | 'LOW' | 'HIGH';

@Injectable()
export class PredictiveCostingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Staff-facing, informational only — same non-auto-executing shape as
   * CommerceService.getRegionalPricingHint: a number staff can weigh
   * while scoping/quoting, never something that sets a quote line itself. */
  async predictDirectCostForCase(caseId: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      select: { serviceType: true, location: true },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');

    return this.predictDirectCost(serviceCase.serviceType, serviceCase.location);
  }

  async predictDirectCost(serviceType: ServiceType, location: string) {
    const zone = classifyZone(location);

    const candidates = await this.prisma.serviceCase.findMany({
      where: { serviceType, status: { in: TERMINAL_STATUSES } },
      select: { location: true, directCosts: { select: { amount: true } } },
    });

    // classifyZone only takes a bare location string — no column to filter
    // on at the DB level, and this is an internal-tool query volume, not a
    // hot path, so filtering in application code is the honest tradeoff.
    const sameZoneTotals = candidates
      .filter((c) => classifyZone(c.location) === zone && c.directCosts.length > 0)
      .map((c) => c.directCosts.reduce((sum, dc) => sum + Number(dc.amount), 0));

    const sampleSize = sameZoneTotals.length;
    const predictedAmountNgn =
      sampleSize > 0 ? sameZoneTotals.reduce((sum, total) => sum + total, 0) / sampleSize : null;

    const confidence: CostConfidence =
      sampleSize === 0 ? 'NONE' : sampleSize < MIN_SAMPLE_FOR_HIGH_CONFIDENCE ? 'LOW' : 'HIGH';

    return {
      serviceType,
      zone,
      sampleSize,
      predictedAmountNgn,
      currency: 'NGN',
      confidence,
    };
  }
}
