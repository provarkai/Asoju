import { Injectable, NotFoundException } from '@nestjs/common';
import { CasePriority, CaseStatus, IncidentSeverity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const HIGH_RISK_LEVEL = 3;
const INCIDENT_SEVERITY_POINTS: Record<IncidentSeverity, number> = {
  LOW: 1,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

interface RiskFactors {
  openRiskFlags: number;
  incidentPointsThisCase: number;
  priorIncidentsOtherCases: number;
  lowPerformingAssignee: boolean;
  urgentPriority: boolean;
  reworkCycles: number;
  highValue: boolean;
}

/**
 * Section 12 P2 "advanced risk engine" — deterministic scoring in plain
 * code, the same philosophy as the Case Engine's state machine
 * (Non-Negotiable #9): risk level is never something an AI model decides.
 * Every factor here comes straight off data the app already writes —
 * nothing is invented or estimated.
 */
@Injectable()
export class RiskEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Recompute and persist a case's risk level. Called automatically at
   * the moments a new risk signal appears (exception raised, QC
   * escalation/incident/rework) and available on demand via
   * POST /cases/:caseId/risk-assessment for staff review or testing. */
  async assessCase(caseId: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: {
        riskFlags: true,
        incidents: true,
        statusHistory: true,
        quotes: true,
        assignments: {
          where: { status: { in: ['OFFERED', 'ACCEPTED', 'IN_PROGRESS'] } },
          include: { agent: { select: { performanceScore: true } }, provider: { select: { performanceScore: true } } },
        },
        customer: {
          include: {
            serviceCases: {
              where: { id: { not: caseId } },
              include: { incidents: true },
            },
          },
        },
      },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const openRiskFlags = Math.min(serviceCase.riskFlags.filter((f) => !f.resolvedAt).length, 3);
    const incidentPointsThisCase = serviceCase.incidents.reduce(
      (sum, i) => sum + INCIDENT_SEVERITY_POINTS[i.severity],
      0,
    );
    const priorIncidentsOtherCases = Math.min(
      serviceCase.customer.serviceCases.reduce((sum, c) => sum + c.incidents.length, 0),
      2,
    );
    const lowPerformingAssignee = serviceCase.assignments.some((a) => {
      const score = a.agent?.performanceScore ?? a.provider?.performanceScore;
      return typeof score === 'number' && score < 3;
    });
    const urgentPriority = serviceCase.priority === CasePriority.URGENT;
    const reworkCycles = Math.min(
      Math.max(serviceCase.statusHistory.filter((h) => h.toStatus === CaseStatus.IN_PROGRESS).length - 1, 0),
      2,
    );
    const highestQuote = serviceCase.quotes.reduce((max, q) => Math.max(max, Number(q.amount)), 0);
    const highValue = highestQuote > 500_000;

    const factors: RiskFactors = {
      openRiskFlags,
      incidentPointsThisCase,
      priorIncidentsOtherCases,
      lowPerformingAssignee,
      urgentPriority,
      reworkCycles,
      highValue,
    };

    const score =
      openRiskFlags +
      incidentPointsThisCase +
      priorIncidentsOtherCases +
      (lowPerformingAssignee ? 2 : 0) +
      (urgentPriority ? 1 : 0) +
      reworkCycles +
      (highValue ? 1 : 0);

    const level = score >= 7 ? 4 : score >= 4 ? 3 : score >= 2 ? 2 : 1;

    const [assessment] = await this.prisma.$transaction([
      this.prisma.riskAssessment.create({
        data: { caseId, score, level, factors: factors as any },
      }),
      this.prisma.serviceCase.update({ where: { id: caseId }, data: { riskLevel: level } }),
    ]);

    await this.audit.record({
      caseId,
      actorType: 'system',
      action: 'case.risk_assessed',
      metadata: { score, level, factors },
    });

    // Surface a high-risk case the same way any other exception surfaces
    // (Non-Negotiable #7) — a CaseRiskFlag the ops queue already counts —
    // without duplicating one on every re-score.
    if (level >= HIGH_RISK_LEVEL) {
      const alreadyFlagged = await this.prisma.caseRiskFlag.findFirst({
        where: { caseId, label: 'Automated risk escalation', resolvedAt: null },
      });
      if (!alreadyFlagged) {
        await this.prisma.caseRiskFlag.create({
          data: {
            caseId,
            label: 'Automated risk escalation',
            detail: `Risk engine scored this case ${score} (level ${level}). Factors: ${JSON.stringify(factors)}`,
          },
        });
      }
    }

    return assessment;
  }

  async listAssessments(caseId: string) {
    return this.prisma.riskAssessment.findMany({ where: { caseId }, orderBy: { assessedAt: 'desc' } });
  }

  /** Compliance/Risk-facing queue — every case currently scored high or
   * critical, with its most recent assessment. */
  async listHighRiskCases() {
    return this.prisma.serviceCase.findMany({
      where: { riskLevel: { gte: HIGH_RISK_LEVEL } },
      include: {
        customer: { select: { fullName: true } },
        riskAssessments: { orderBy: { assessedAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
}
