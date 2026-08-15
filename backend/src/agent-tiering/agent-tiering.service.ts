import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AgentTier, AssignmentRole, MembershipPlan, QcOutcome, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/// Platform Expansion PRD §5.1 "Field Agent Tiering & Auto-Assignment" —
/// "Deterministic scoring engine for Field Agents based on historic QC pass
/// rate and ratings." Both halves already existed separately before this:
/// performanceScore (ratings.service.ts, rolling average of customer
/// stars) and QcReview (this session, one row per QC decision). This
/// service is just the deterministic combination of the two into a tier —
/// same "never something an AI model decides" philosophy as RiskEngineService.
const PASSING_QC_OUTCOMES: QcOutcome[] = [QcOutcome.APPROVED, QcOutcome.PASS_WITH_LIMITATION];

/// Below this many QC reviews, an agent's pass rate isn't a reliable
/// signal yet — stay BRONZE rather than let one early case swing a tier.
const MIN_QC_SAMPLE = 3;

const GOLD_THRESHOLDS = { performanceScore: 4.5, qcPassRate: 0.9 };
const SILVER_THRESHOLDS = { performanceScore: 3.5, qcPassRate: 0.75 };

interface QcPassRateResult {
  qcPassRate: number | null;
  sampleSize: number;
}

@Injectable()
export class AgentTieringService {
  private readonly logger = new Logger(AgentTieringService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async computeQcPassRate(agentId: string): Promise<QcPassRateResult> {
    const reviews = await this.prisma.qcReview.findMany({
      where: { case: { assignments: { some: { agentId, role: AssignmentRole.FIELD_AGENT } } } },
      select: { outcome: true },
    });
    if (reviews.length === 0) return { qcPassRate: null, sampleSize: 0 };
    const passing = reviews.filter((r) => PASSING_QC_OUTCOMES.includes(r.outcome)).length;
    return { qcPassRate: passing / reviews.length, sampleSize: reviews.length };
  }

  private determineTier(performanceScore: number | null, result: QcPassRateResult): AgentTier {
    const { qcPassRate, sampleSize } = result;
    if (sampleSize < MIN_QC_SAMPLE || performanceScore === null || qcPassRate === null) {
      return AgentTier.BRONZE;
    }
    if (performanceScore >= GOLD_THRESHOLDS.performanceScore && qcPassRate >= GOLD_THRESHOLDS.qcPassRate) {
      return AgentTier.GOLD;
    }
    if (performanceScore >= SILVER_THRESHOLDS.performanceScore && qcPassRate >= SILVER_THRESHOLDS.qcPassRate) {
      return AgentTier.SILVER;
    }
    return AgentTier.BRONZE;
  }

  /** Recompute and persist one agent's tier. Called automatically after
   * every QC decision on a case they worked (recomputeAgentsForCase) and
   * swept nightly for everyone (recomputeAllTiers) — same "recompute on
   * write + cron sweep" shape as SubscriptionBillingService. */
  async recomputeAgentTier(agentId: string) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId }, select: { performanceScore: true } });
    if (!agent) throw new NotFoundException('Agent not found');

    const qcResult = await this.computeQcPassRate(agentId);
    const tier = this.determineTier(agent.performanceScore, qcResult);

    return this.prisma.agent.update({
      where: { id: agentId },
      data: { tier, qcPassRate: qcResult.qcPassRate },
    });
  }

  /** Hooked into EvidenceService.performQc — recomputes tier for whichever
   * field agent(s) the case's QC decision was just recorded against. */
  async recomputeAgentsForCase(caseId: string) {
    const assignments = await this.prisma.assignment.findMany({
      where: { caseId, role: AssignmentRole.FIELD_AGENT, agentId: { not: null } },
      select: { agentId: true },
      distinct: ['agentId'],
    });
    for (const { agentId } of assignments) {
      if (agentId) await this.recomputeAgentTier(agentId);
    }
  }

  /** PRD: "computed via cron job analyzing historic Assignment data" — the
   * cron entry point (AgentTieringSchedulerService); also reachable on
   * demand via POST /admin/agent-tiering/run for testing, same convention
   * as subscription billing's run-billing endpoint. */
  async recomputeAllTiers(): Promise<{ recomputed: number; tiers: Record<AgentTier, number> }> {
    const agents = await this.prisma.agent.findMany({ where: { isActive: true }, select: { id: true } });
    const tiers: Record<AgentTier, number> = { BRONZE: 0, SILVER: 0, GOLD: 0 };
    for (const { id } of agents) {
      const updated = await this.recomputeAgentTier(id);
      tiers[updated.tier]++;
    }
    this.logger.log(`Agent tiering sweep: recomputed=${agents.length} tiers=${JSON.stringify(tiers)}`);
    return { recomputed: agents.length, tiers };
  }

  /** PRD: tier "used as a weighting factor in the assignment algorithm" —
   * ASOJU has no auto-assignment engine (staff explicitly picks an agent
   * via POST cases/:caseId/assignments), so this is the same
   * staff-facing, informational-only shape as CommerceService's
   * getRegionalPricingHint: a ranked suggestion, never an auto-execution.
   * "Auto-assigns Gold agents to Premium members" becomes "Gold agents
   * are ranked first, and we flag when this customer is Premium" —
   * staff still makes the call. */
  async suggestAgentsForCase(caseId: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: {
        customer: {
          include: { subscriptions: { where: { status: SubscriptionStatus.ACTIVE }, take: 1 } },
        },
      },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const premiumCustomer = serviceCase.customer.subscriptions.some((s) => s.plan === MembershipPlan.PREMIUM);

    const agents = await this.prisma.agent.findMany({
      where: { isActive: true },
      orderBy: [{ tier: 'desc' }, { performanceScore: { sort: 'desc', nulls: 'last' } }],
    });

    return {
      caseId,
      premiumCustomer,
      agents: agents.map((a) => ({
        agentId: a.id,
        fullName: a.fullName,
        city: a.city,
        state: a.state,
        tier: a.tier,
        performanceScore: a.performanceScore,
        qcPassRate: a.qcPassRate,
      })),
    };
  }
}
