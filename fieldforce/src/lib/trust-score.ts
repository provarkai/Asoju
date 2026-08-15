// ═══════════════════════════════════════════════════════════════════════════════
// ASOJU FieldForce — Agent Trust Score Engine
// Multi-component weighted scoring with tier progression and trend tracking
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';

// ─── Trust Tier Definitions ─────────────────────────────────────────────────

export interface TrustTier {
  min: number;
  tier: string;
  badge: string;
  label: string;
}

export const TRUST_TIERS: TrustTier[] = [
  { min: 0,  tier: 'NEW',      badge: '🆕', label: 'New Agent' },
  { min: 20, tier: 'BRONZE',  badge: '🥉', label: 'Bronze — Verified' },
  { min: 40, tier: 'SILVER',  badge: '🥈', label: 'Silver — Trusted' },
  { min: 65, tier: 'GOLD',    badge: '🥇', label: 'Gold — Top Agent' },
  { min: 85, tier: 'PLATINUM', badge: '💎', label: 'Platinum — Elite' },
];

// ─── Component Weights ─────────────────────────────────────────────────────

export const TRUST_WEIGHTS = {
  completion: 0.30,
  gps:        0.20,
  evidence:   0.20,
  rating:     0.20,
  response:   0.10,
} as const;

// ─── Score Component Breakdown ─────────────────────────────────────────────

export interface ScoreComponents {
  completionScore: number;
  gpsComplianceScore: number;
  evidenceScore: number;
  customerRating: number;
  responseScore: number;
}

// ─── Trust Score Record (from DB) ───────────────────────────────────────────

export interface TrustScoreRecord {
  id: string;
  agentId: string;
  completionScore: number;
  gpsComplianceScore: number;
  evidenceScore: number;
  customerRating: number;
  responseScore: number;
  compositeScore: number;
  trustTier: string;
  trustBadge: string | null;
  totalMissions: number;
  completedMissions: number;
  failedMissions: number;
  avgResponseMin: number | null;
  previousScore: number | null;
  scoreTrend: string;
  calculatedAt: string;
  updatedAt: string;
}

// ─── Leaderboard Entry ──────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  agentPhone: string;
  avatarUrl: string | null;
  compositeScore: number;
  trustTier: string;
  trustBadge: string | null;
  totalMissions: number;
  completedMissions: number;
}

// ─── Trust Profile (full agent trust view) ─────────────────────────────────

export interface AgentTrustProfile {
  agentId: string;
  agentName: string;
  agentPhone: string;
  avatarUrl: string | null;
  current: TrustScoreRecord;
  tier: TrustTier;
  components: ScoreComponents;
  volumeMetrics: {
    totalMissions: number;
    completedMissions: number;
    failedMissions: number;
    completionRate: number;
    avgResponseMin: number | null;
  };
}

// ─── Minimum Missions for Statistically Meaningful Scores ───────────────────

const MIN_MISSIONS_FOR_COMPLETION = 10;
const MIN_MISSIONS_FOR_GPS = 5;
const MIN_MISSIONS_FOR_EVIDENCE = 5;

// ─── Response Time Scoring (lower = better) ─────────────────────────────────
// Score 100 if ≤ 5 min, 80 if ≤ 15 min, 60 if ≤ 30 min, 40 if ≤ 60 min, 20 if ≤ 120 min, 0 if > 120 min

function scoreResponseTime(avgMinutes: number | null): number {
  if (avgMinutes === null) return 0;
  if (avgMinutes <= 5)   return 100;
  if (avgMinutes <= 15)  return 80;
  if (avgMinutes <= 30)  return 60;
  if (avgMinutes <= 60)  return 40;
  if (avgMinutes <= 120) return 20;
  return 0;
}

// ─── Determine Trust Tier from Composite Score ─────────────────────────────

export function getTrustTier(score: number): TrustTier {
  for (let i = TRUST_TIERS.length - 1; i >= 0; i--) {
    if (score >= TRUST_TIERS[i].min) {
      return TRUST_TIERS[i];
    }
  }
  return TRUST_TIERS[0]; // NEW as fallback
}

// ─── Determine Score Trend ──────────────────────────────────────────────────

function determineTrend(current: number, previous: number | null): string {
  if (previous === null) return 'STABLE';
  const delta = current - previous;
  if (delta > 2)  return 'IMPROVING';
  if (delta < -2) return 'DECLINING';
  return 'STABLE';
}

// ─── Calculate Agent Trust Score ────────────────────────────────────────────
//
// Computes all 5 component scores, calculates the weighted composite,
// determines the trust tier, and upserts the AgentTrustScore record.

export async function calculateAgentTrustScore(
  agentId: string,
): Promise<TrustScoreRecord> {
  // Fetch existing score (for trend tracking)
  const existing = await db.agentTrustScore.findUnique({
    where: { agentId },
  });

  // ── 1. Completion Score (30%) ──────────────────────────────────────────────
  // Missions completed vs total. Requires min 10 missions for accuracy;
  // below that threshold, score is linearly scaled to avoid volatility.
  const missions = await db.mission.findMany({
    where: { agentId },
    select: { workflowState: true },
  });

  const totalMissions = missions.length;
  const completedMissions = missions.filter(m => m.workflowState === 'COMPLETED').length;
  const failedMissions = missions.filter(m => m.workflowState === 'FAILED').length;

  let completionScore: number;
  if (totalMissions === 0) {
    completionScore = 0;
  } else if (totalMissions < MIN_MISSIONS_FOR_COMPLETION) {
    const rawRate = (completedMissions / totalMissions) * 100;
    const volumeWeight = totalMissions / MIN_MISSIONS_FOR_COMPLETION;
    completionScore = Math.round((rawRate * volumeWeight) + (50 * (1 - volumeWeight)));
  } else {
    completionScore = Math.round((completedMissions / totalMissions) * 100);
  }

  // ── 2. GPS Compliance Score (20%) ─────────────────────────────────────────
  // % of GPS checks that passed
  const gpsChecks = await db.gpsCheck.findMany({
    where: { agentId },
    select: { result: true },
  });

  let gpsComplianceScore: number;
  if (gpsChecks.length === 0) {
    gpsComplianceScore = 0;
  } else if (gpsChecks.length < MIN_MISSIONS_FOR_GPS) {
    const passedCount = gpsChecks.filter(g => g.result === 'PASS').length;
    const rawRate = (passedCount / gpsChecks.length) * 100;
    const volumeWeight = gpsChecks.length / MIN_MISSIONS_FOR_GPS;
    gpsComplianceScore = Math.round((rawRate * volumeWeight) + (50 * (1 - volumeWeight)));
  } else {
    const passedCount = gpsChecks.filter(g => g.result === 'PASS').length;
    gpsComplianceScore = Math.round((passedCount / gpsChecks.length) * 100);
  }

  // ── 3. Evidence Score (20%) ────────────────────────────────────────────────
  // % of missions where evidence was submitted on time (before SLA submission target)
  const agentMissions = await db.mission.findMany({
    where: { agentId },
    select: { id: true, slaSubmissionTarget: true },
  });

  const missionIds = agentMissions.map(m => m.id);
  let evidenceScore = 0;

  if (missionIds.length > 0) {
    const allEvidence = await db.evidenceItem.findMany({
      where: { agentId },
      select: { missionId: true, capturedAt: true },
    });

    // Group evidence by mission
    const evidenceByMission = new Map<string, typeof allEvidence>();
    for (const ev of allEvidence) {
      const list = evidenceByMission.get(ev.missionId) ?? [];
      list.push(ev);
      evidenceByMission.set(ev.missionId, list);
    }

    let missionsWithOnTimeEvidence = 0;

    for (const mission of agentMissions) {
      const evidence = evidenceByMission.get(mission.id);
      if (!evidence || evidence.length === 0) continue;

      const earliestCapture = evidence
        .filter(e => e.capturedAt !== null)
        .sort((a, b) => a.capturedAt!.getTime() - b.capturedAt!.getTime())[0];

      if (!earliestCapture) continue;

      if (mission.slaSubmissionTarget && earliestCapture.capturedAt! <= mission.slaSubmissionTarget) {
        missionsWithOnTimeEvidence++;
      } else if (!mission.slaSubmissionTarget) {
        // No SLA target — assume on time if evidence exists
        missionsWithOnTimeEvidence++;
      }
    }

    if (missionIds.length >= MIN_MISSIONS_FOR_EVIDENCE) {
      evidenceScore = Math.round((missionsWithOnTimeEvidence / missionIds.length) * 100);
    } else if (missionIds.length > 0) {
      const rawRate = (missionsWithOnTimeEvidence / missionIds.length) * 100;
      const volumeWeight = missionIds.length / MIN_MISSIONS_FOR_EVIDENCE;
      evidenceScore = Math.round((rawRate * volumeWeight) + (50 * (1 - volumeWeight)));
    }
  }

  // ── 4. Customer Rating (20%) ──────────────────────────────────────────────
  // Agent.rating from the Agent model, scaled 0-100
  const agent = await db.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: { rating: true },
  });
  // Rating is 0-5 (float), scale to 0-100
  const customerRating = Math.round(agent.rating * 20);

  // ── 5. Response Score (10%) ───────────────────────────────────────────────
  // Average time from mission offered to accepted (lower = better)
  const assignments = await db.missionAssignment.findMany({
    where: { agentId, acceptedAt: { not: null } },
    select: { offeredAt: true, acceptedAt: true },
  });

  let avgResponseMin: number | null = null;
  let responseScore = 0;

  if (assignments.length > 0) {
    const responseTimes = assignments.map(a => {
      const offered = new Date(a.offeredAt).getTime();
      const accepted = new Date(a.acceptedAt!).getTime();
      return (accepted - offered) / (1000 * 60); // minutes
    });
    avgResponseMin = responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length;
    responseScore = scoreResponseTime(avgResponseMin);
  }

  // ── Composite Score ───────────────────────────────────────────────────────
  const compositeScore = Math.round(
    (completionScore * TRUST_WEIGHTS.completion) +
    (gpsComplianceScore * TRUST_WEIGHTS.gps) +
    (evidenceScore * TRUST_WEIGHTS.evidence) +
    (customerRating * TRUST_WEIGHTS.rating) +
    (responseScore * TRUST_WEIGHTS.response)
  );

  const clampedScore = Math.max(0, Math.min(100, compositeScore));

  // ── Tier & Trend ──────────────────────────────────────────────────────────
  const tier = getTrustTier(clampedScore);
  const trend = determineTrend(clampedScore, existing?.compositeScore ?? null);

  // ── Upsert Trust Score Record ─────────────────────────────────────────────
  const saved = await db.agentTrustScore.upsert({
    where: { agentId },
    create: {
      agentId,
      completionScore,
      gpsComplianceScore,
      evidenceScore,
      customerRating,
      responseScore,
      compositeScore: clampedScore,
      trustTier: tier.tier,
      trustBadge: tier.badge,
      totalMissions,
      completedMissions,
      failedMissions,
      avgResponseMin,
      previousScore: existing?.compositeScore ?? null,
      scoreTrend: trend,
    },
    update: {
      completionScore,
      gpsComplianceScore,
      evidenceScore,
      customerRating,
      responseScore,
      compositeScore: clampedScore,
      trustTier: tier.tier,
      trustBadge: tier.badge,
      totalMissions,
      completedMissions,
      failedMissions,
      avgResponseMin,
      previousScore: existing?.compositeScore ?? null,
      scoreTrend: trend,
    },
  });

  return saved as unknown as TrustScoreRecord;
}

// ─── Bulk Recalculate All Agent Trust Scores ────────────────────────────────
// Designed for cron job usage. Processes all ACTIVE agents.

export async function bulkRecalculateTrustScores(): Promise<{
  processed: number;
  errors: number;
  durationMs: number;
}> {
  const start = Date.now();
  let processed = 0;
  let errors = 0;

  const activeAgents = await db.agent.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  for (const agent of activeAgents) {
    try {
      await calculateAgentTrustScore(agent.id);
      processed++;
    } catch (err) {
      console.error(`[TrustScore] Failed to recalculate for agent ${agent.id}:`, err);
      errors++;
    }
  }

  return { processed, errors, durationMs: Date.now() - start };
}

// ─── Get Trust Leaderboard ──────────────────────────────────────────────────
// Returns top agents sorted by composite score, optionally filtered by tier.

export async function getTrustLeaderboard(
  limit: number = 20,
  tier?: string,
): Promise<LeaderboardEntry[]> {
  const where = tier ? { trustTier: tier } : {};

  const scores = await db.agentTrustScore.findMany({
    where,
    orderBy: { compositeScore: 'desc' },
    take: limit,
    include: {
      agent: {
        select: { displayName: true, phone: true, avatarUrl: true },
      },
    },
  });

  return scores.map((s, index) => ({
    rank: index + 1,
    agentId: s.agentId,
    agentName: s.agent.displayName,
    agentPhone: s.agent.phone,
    avatarUrl: s.agent.avatarUrl,
    compositeScore: s.compositeScore,
    trustTier: s.trustTier,
    trustBadge: s.trustBadge,
    totalMissions: s.totalMissions,
    completedMissions: s.completedMissions,
  }));
}

// ─── Get Full Agent Trust Profile ──────────────────────────────────────────
// Returns the current trust score, tier, component breakdown, and volume metrics.

export async function getAgentTrustProfile(
  agentId: string,
): Promise<AgentTrustProfile> {
  const trustScore = await db.agentTrustScore.findUniqueOrThrow({
    where: { agentId },
  });

  const agent = await db.agent.findUniqueOrThrow({
    where: { id: agentId },
    select: { displayName: true, phone: true, avatarUrl: true },
  });

  const tier = getTrustTier(trustScore.compositeScore);

  const totalMissions = trustScore.totalMissions;
  const completedMissions = trustScore.completedMissions;
  const completionRate = totalMissions > 0
    ? Math.round((completedMissions / totalMissions) * 100)
    : 0;

  return {
    agentId,
    agentName: agent.displayName,
    agentPhone: agent.phone,
    avatarUrl: agent.avatarUrl,
    current: trustScore as unknown as TrustScoreRecord,
    tier,
    components: {
      completionScore: trustScore.completionScore,
      gpsComplianceScore: trustScore.gpsComplianceScore,
      evidenceScore: trustScore.evidenceScore,
      customerRating: trustScore.customerRating,
      responseScore: trustScore.responseScore,
    },
    volumeMetrics: {
      totalMissions,
      completedMissions,
      failedMissions: trustScore.failedMissions,
      completionRate,
      avgResponseMin: trustScore.avgResponseMin,
    },
  };
}
