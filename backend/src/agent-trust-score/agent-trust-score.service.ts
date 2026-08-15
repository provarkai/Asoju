import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CaseStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Trust Score — ported from FieldForce's trust-score.ts
// ═══════════════════════════════════════════════════════════════════════════════
// A richer, complementary signal to Agent.tier/qcPassRate (#28's assignment-
// weighting tier, driven by QcReview outcomes) — not a replacement. Same
// component/weight structure as FieldForce's version, but each component is
// adapted to what ASOJU's data model actually tracks, not a literal copy:
//
//   - FieldForce measures completion against Mission.workflowState (which
//     has a real FAILED state). ASOJU's CaseStatus has no equivalent hard
//     failure state — every case either progresses toward COMPLETED/CLOSED
//     or sits in a recoverable state (DISPUTED always resolves back to
//     ADDITIONAL_WORK, ON_HOLD always resumes). So "completion" here means
//     the fraction of this agent's assignments whose case has actually
//     reached COMPLETED/CLOSED, not a success-vs-failure ratio.
//   - FieldForce's GPS score comes from a GpsCheck table recording every
//     attempt, pass or fail. ASOJU's Assignment.checkIn (see #35's
//     geofence.ts) never persists a rejected attempt on the Assignment row
//     itself — only the audit log does (`assignment.check_in_rejected`).
//     This reads both: PASS results directly off Assignment, rejections
//     from the audit trail, and only judges attempts where a real geofence
//     target existed (OUTSIDE_GEOFENCE) — never penalises an agent for
//     working a case with no property coordinates on file.
//   - FieldForce's evidence score compares against Mission.slaSubmissionTarget.
//     ASOJU's equivalent is ServiceCase.slaTargetAt.
//   - FieldForce's rating component recomputes its own average; ASOJU
//     already maintains Agent.performanceScore (ratings.service.ts) — this
//     reuses it directly rather than re-deriving the same number twice,
//     normalised from its 1-5 star scale to 0-100.
//   - Response time uses Assignment.acceptedAt - Assignment.createdAt in
//     place of FieldForce's offer-to-accept mission timestamps.

export interface TrustTier {
  min: number;
  tier: string;
  badge: string;
  label: string;
}

export const TRUST_TIERS: TrustTier[] = [
  { min: 0, tier: 'NEW', badge: '🆕', label: 'New Agent' },
  { min: 20, tier: 'BRONZE', badge: '🥉', label: 'Bronze — Verified' },
  { min: 40, tier: 'SILVER', badge: '🥈', label: 'Silver — Trusted' },
  { min: 65, tier: 'GOLD', badge: '🥇', label: 'Gold — Top Agent' },
  { min: 85, tier: 'PLATINUM', badge: '💎', label: 'Platinum — Elite' },
];

export const TRUST_WEIGHTS = {
  completion: 0.3,
  gps: 0.2,
  evidence: 0.2,
  rating: 0.2,
  response: 0.1,
} as const;

const MIN_FOR_COMPLETION = 10;
const MIN_FOR_GPS = 5;
const MIN_FOR_EVIDENCE = 5;
const COMPLETED_CASE_STATUSES: CaseStatus[] = [CaseStatus.COMPLETED, CaseStatus.CLOSED];

export function getTrustTier(score: number): TrustTier {
  for (let i = TRUST_TIERS.length - 1; i >= 0; i--) {
    if (score >= TRUST_TIERS[i].min) return TRUST_TIERS[i];
  }
  return TRUST_TIERS[0];
}

function volumeBlend(rawRate: number, sampleSize: number, minSample: number): number {
  const volumeWeight = sampleSize / minSample;
  return Math.round(rawRate * volumeWeight + 50 * (1 - volumeWeight));
}

function scoreResponseTime(avgMinutes: number | null): number {
  if (avgMinutes === null) return 0;
  if (avgMinutes <= 5) return 100;
  if (avgMinutes <= 15) return 80;
  if (avgMinutes <= 30) return 60;
  if (avgMinutes <= 60) return 40;
  if (avgMinutes <= 120) return 20;
  return 0;
}

function determineTrend(current: number, previous: number | null): string {
  if (previous === null) return 'STABLE';
  const delta = current - previous;
  if (delta > 2) return 'IMPROVING';
  if (delta < -2) return 'DECLINING';
  return 'STABLE';
}

@Injectable()
export class AgentTrustScoreService {
  private readonly logger = new Logger(AgentTrustScoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculateTrustScore(agentId: string) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');

    const existing = await this.prisma.agentTrustScore.findUnique({ where: { agentId } });

    const assignments = await this.prisma.assignment.findMany({
      where: { agentId, role: 'FIELD_AGENT' },
      select: {
        caseId: true,
        createdAt: true,
        acceptedAt: true,
        geofenceResult: true,
      },
    });

    // ── Completion ────────────────────────────────────────────────────────
    const totalAssignments = assignments.length;
    let completedAssignments = 0;
    if (totalAssignments > 0) {
      const cases = await this.prisma.serviceCase.findMany({
        where: { id: { in: assignments.map((a) => a.caseId) } },
        select: { id: true, status: true },
      });
      const statusByCase = new Map(cases.map((c) => [c.id, c.status]));
      completedAssignments = assignments.filter((a) => {
        const status = statusByCase.get(a.caseId);
        return status && COMPLETED_CASE_STATUSES.includes(status);
      }).length;
    }
    const completionScore =
      totalAssignments === 0
        ? 0
        : totalAssignments < MIN_FOR_COMPLETION
          ? volumeBlend((completedAssignments / totalAssignments) * 100, totalAssignments, MIN_FOR_COMPLETION)
          : Math.round((completedAssignments / totalAssignments) * 100);

    // ── GPS compliance ───────────────────────────────────────────────────
    const passedCheckIns = assignments.filter((a) => a.geofenceResult === 'PASS').length;
    const rejectedEvents = await this.prisma.auditEvent.findMany({
      where: { actorId: agent.userId, action: 'assignment.check_in_rejected' },
      select: { metadata: true },
    });
    const outsideGeofenceRejections = rejectedEvents.filter(
      (e) => (e.metadata as { reason?: string } | null)?.reason === 'OUTSIDE_GEOFENCE',
    ).length;
    const judgedCheckIns = passedCheckIns + outsideGeofenceRejections;
    const gpsComplianceScore =
      judgedCheckIns === 0
        ? 0
        : judgedCheckIns < MIN_FOR_GPS
          ? volumeBlend((passedCheckIns / judgedCheckIns) * 100, judgedCheckIns, MIN_FOR_GPS)
          : Math.round((passedCheckIns / judgedCheckIns) * 100);

    // ── Evidence timeliness ──────────────────────────────────────────────
    let evidenceScore = 0;
    if (totalAssignments > 0) {
      const caseIds = assignments.map((a) => a.caseId);
      const [cases, evidence] = await Promise.all([
        this.prisma.serviceCase.findMany({ where: { id: { in: caseIds } }, select: { id: true, slaTargetAt: true } }),
        this.prisma.evidence.findMany({
          where: { caseId: { in: caseIds }, uploaderId: agent.userId },
          select: { caseId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      const slaByCase = new Map(cases.map((c) => [c.id, c.slaTargetAt]));
      const earliestEvidenceByCase = new Map<string, Date>();
      for (const item of evidence) {
        if (!earliestEvidenceByCase.has(item.caseId)) earliestEvidenceByCase.set(item.caseId, item.createdAt);
      }

      let onTimeCount = 0;
      for (const caseId of caseIds) {
        const earliest = earliestEvidenceByCase.get(caseId);
        if (!earliest) continue;
        const slaTarget = slaByCase.get(caseId);
        if (!slaTarget || earliest <= slaTarget) onTimeCount++;
      }

      evidenceScore =
        totalAssignments < MIN_FOR_EVIDENCE
          ? volumeBlend((onTimeCount / totalAssignments) * 100, totalAssignments, MIN_FOR_EVIDENCE)
          : Math.round((onTimeCount / totalAssignments) * 100);
    }

    // ── Rating (reused, not re-derived) ─────────────────────────────────
    const ratingScore = agent.performanceScore != null ? Math.round((agent.performanceScore / 5) * 100) : 0;

    // ── Response time ────────────────────────────────────────────────────
    const responseTimes = assignments
      .filter((a) => a.acceptedAt)
      .map((a) => (a.acceptedAt!.getTime() - a.createdAt.getTime()) / 60_000);
    const avgResponseMin =
      responseTimes.length > 0 ? responseTimes.reduce((sum, m) => sum + m, 0) / responseTimes.length : null;
    const responseScore = scoreResponseTime(avgResponseMin);

    // ── Composite ─────────────────────────────────────────────────────────
    const compositeScore = Math.round(
      completionScore * TRUST_WEIGHTS.completion +
        gpsComplianceScore * TRUST_WEIGHTS.gps +
        evidenceScore * TRUST_WEIGHTS.evidence +
        ratingScore * TRUST_WEIGHTS.rating +
        responseScore * TRUST_WEIGHTS.response,
    );

    const tier = getTrustTier(compositeScore);
    const scoreTrend = determineTrend(compositeScore, existing?.compositeScore ?? null);

    return this.prisma.agentTrustScore.upsert({
      where: { agentId },
      create: {
        agentId,
        completionScore,
        gpsComplianceScore,
        evidenceScore,
        ratingScore,
        responseScore,
        compositeScore,
        trustTier: tier.tier,
        trustBadge: tier.badge,
        totalAssignments,
        completedAssignments,
        previousScore: null,
        scoreTrend,
      },
      update: {
        completionScore,
        gpsComplianceScore,
        evidenceScore,
        ratingScore,
        responseScore,
        compositeScore,
        trustTier: tier.tier,
        trustBadge: tier.badge,
        totalAssignments,
        completedAssignments,
        previousScore: existing?.compositeScore ?? null,
        scoreTrend,
      },
    });
  }

  async recomputeAllTrustScores(): Promise<{ processed: number }> {
    const agents = await this.prisma.agent.findMany({ where: { isActive: true }, select: { id: true } });
    for (const agent of agents) {
      try {
        await this.calculateTrustScore(agent.id);
      } catch (error) {
        this.logger.error(`Trust score recompute failed for agent ${agent.id}`, error as Error);
      }
    }
    return { processed: agents.length };
  }

  async getTrustProfile(actor: AuthenticatedUser, agentId: string) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');

    const isOps = actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN || actor.role === Role.CASE_MANAGER;
    const isOwnProfile = agent.userId === actor.id;
    if (!isOps && !isOwnProfile) {
      throw new ForbiddenException('Not authorised to view this agent’s trust profile');
    }

    const score = await this.prisma.agentTrustScore.findUnique({ where: { agentId } });
    if (!score) {
      // Never computed yet — compute once on first request rather than
      // returning an empty/misleading profile.
      return this.calculateTrustScore(agentId);
    }
    return score;
  }

  async getLeaderboard(limit = 20) {
    const scores = await this.prisma.agentTrustScore.findMany({
      orderBy: { compositeScore: 'desc' },
      take: limit,
      include: { agent: { select: { id: true, fullName: true, city: true, state: true } } },
    });

    return scores.map((s, index) => ({
      rank: index + 1,
      agentId: s.agentId,
      agentName: s.agent.fullName,
      city: s.agent.city,
      state: s.agent.state,
      compositeScore: s.compositeScore,
      trustTier: s.trustTier,
      trustBadge: s.trustBadge,
      totalAssignments: s.totalAssignments,
      completedAssignments: s.completedAssignments,
    }));
  }
}
