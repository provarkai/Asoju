import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CasesService } from '../cases/cases.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TriggerSosDto } from './dto/trigger-sos.dto';
import { EscalateSosDto } from './dto/escalate-sos.dto';

// ═══════════════════════════════════════════════════════════════════════════════
// Emergency SOS Protocol — inherited from FieldForce's sos-protocol.ts
// ═══════════════════════════════════════════════════════════════════════════════
// Trigger/acknowledge/resolve/escalate for a field agent in trouble, same
// lifecycle and 4-channel escalation chain (admin -> whatsapp ->
// emergency_contact -> police) as FieldForce's version. One real
// adaptation, not just a port: FieldForce's SosAlert.evidenceLocked is a
// boolean flag that nothing else in that codebase actually enforces —
// here, a HIGH/CRITICAL alert against an active case calls this app's
// real CasesService.holdCase(), which is an enforced, auditable state
// change (CaseStatusHistory + AuditEvent), not a passive flag.

export const SOS_ALERT_TYPES = {
  GENERAL: 'GENERAL',
  MEDICAL: 'MEDICAL',
  SECURITY: 'SECURITY',
  SAFETY: 'SAFETY',
  LOST: 'LOST',
} as const;

export const SOS_SEVERITY_LEVELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export const SOS_STATUS = {
  ACTIVE: 'ACTIVE',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
  ESCALATED: 'ESCALATED',
  FALSE_ALARM: 'FALSE_ALARM',
} as const;

export const ESCALATION_CHANNELS = ['admin', 'whatsapp', 'emergency_contact', 'police'] as const;

const MAX_ESCALATION_LEVEL = ESCALATION_CHANNELS.length;

// Severities that trigger the real case-hold side effect, mirroring
// FieldForce's "active mission -> lock evidence" trigger condition.
const HOLD_TRIGGERING_SEVERITIES: string[] = [SOS_SEVERITY_LEVELS.HIGH, SOS_SEVERITY_LEVELS.CRITICAL];

// Case statuses holdCase() itself already refuses (already held, or
// terminal) — checked here first so a HIGH/CRITICAL alert never throws
// just because the case happened to already be on hold.
const NOT_HOLDABLE_STATUSES: CaseStatus[] = [CaseStatus.ON_HOLD, CaseStatus.COMPLETED, CaseStatus.CLOSED];

@Injectable()
export class AgentSosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cases: CasesService,
    private readonly notifications: NotificationsService,
  ) {}

  private async requireOwnAgent(actor: AuthenticatedUser): Promise<{ id: string }> {
    const agent = await this.prisma.agent.findUnique({ where: { userId: actor.id } });
    if (!agent) throw new ForbiddenException('Only a field agent can trigger an SOS alert');
    return agent;
  }

  /** Field agent triggers a real emergency alert. Coordinates are
   * validated the same way FieldForce's version does; alertType/severity
   * are already constrained by TriggerSosDto's @IsIn. */
  async triggerSosAlert(actor: AuthenticatedUser, dto: TriggerSosDto) {
    const agent = await this.requireOwnAgent(actor);

    if (dto.latitude < -90 || dto.latitude > 90 || dto.longitude < -180 || dto.longitude > 180) {
      throw new BadRequestException('Invalid GPS coordinates for SOS alert');
    }

    let caseHeld = false;
    if (dto.caseId) {
      const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: dto.caseId } });
      if (!serviceCase) throw new NotFoundException('Case not found');

      if (HOLD_TRIGGERING_SEVERITIES.includes(dto.severity) && !NOT_HOLDABLE_STATUSES.includes(serviceCase.status)) {
        await this.cases.holdCase(actor, dto.caseId, `Emergency SOS alert triggered by field agent (${dto.severity})`);
        caseHeld = true;
      }
    }

    if (dto.assignmentId) {
      const assignment = await this.prisma.assignment.findUnique({ where: { id: dto.assignmentId } });
      if (!assignment) throw new NotFoundException('Assignment not found');
    }

    const alert = await this.prisma.sosAlert.create({
      data: {
        agentId: agent.id,
        caseId: dto.caseId,
        assignmentId: dto.assignmentId,
        alertType: dto.alertType,
        severity: dto.severity,
        message: dto.message,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy,
        address: dto.address,
        caseHeld,
      },
    });

    await this.audit.record({
      caseId: dto.caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'agent.sos_triggered',
      metadata: { alertId: alert.id, alertType: dto.alertType, severity: dto.severity, caseHeld },
    });

    await this.notifyAdmins(alert.id, dto.alertType, dto.severity);

    return alert;
  }

  private async notifyAdmins(alertId: string, alertType: string, severity: string) {
    const admins = await this.prisma.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.SUPER_ADMIN] } },
      select: { id: true },
    });
    await Promise.all(
      admins.map((admin) =>
        this.notifications.notify(
          admin.id,
          `🚨 SOS Alert — ${severity}`,
          `A field agent triggered a ${alertType} emergency alert (${severity}). Alert ID: ${alertId}`,
        ),
      ),
    );
  }

  /** Staff acknowledges the alert — indicates they are aware and responding. */
  async acknowledgeSosAlert(actor: AuthenticatedUser, alertId: string) {
    const alert = await this.getAlertOrThrow(alertId);
    if (alert.status !== SOS_STATUS.ACTIVE && alert.status !== SOS_STATUS.ESCALATED) {
      throw new BadRequestException(
        `Cannot acknowledge an SOS alert in status ${alert.status} — only ACTIVE or ESCALATED alerts can be acknowledged`,
      );
    }

    const updated = await this.prisma.sosAlert.update({
      where: { id: alertId },
      data: { status: SOS_STATUS.ACKNOWLEDGED, acknowledgedById: actor.id, acknowledgedAt: new Date() },
    });

    await this.audit.record({
      caseId: alert.caseId ?? undefined,
      actorId: actor.id,
      actorType: 'user',
      action: 'agent.sos_acknowledged',
      metadata: { alertId },
    });

    return updated;
  }

  /** Staff resolves the alert with resolution notes. Terminal — a
   * RESOLVED or FALSE_ALARM alert cannot be reopened; a fresh SOS is a
   * new alert. Deliberately does not auto-resume a held case — resuming
   * is its own explicit decision (CasesService.resumeCase), not implied
   * by "the emergency is over." */
  async resolveSosAlert(actor: AuthenticatedUser, alertId: string, resolutionNotes: string) {
    const alert = await this.getAlertOrThrow(alertId);
    if (alert.status === SOS_STATUS.RESOLVED || alert.status === SOS_STATUS.FALSE_ALARM) {
      throw new BadRequestException(`SOS alert is already in a terminal status: ${alert.status}`);
    }

    const updated = await this.prisma.sosAlert.update({
      where: { id: alertId },
      data: { status: SOS_STATUS.RESOLVED, resolvedById: actor.id, resolvedAt: new Date(), resolutionNotes },
    });

    await this.audit.record({
      caseId: alert.caseId ?? undefined,
      actorId: actor.id,
      actorType: 'user',
      action: 'agent.sos_resolved',
      metadata: { alertId, resolutionNotes },
    });

    return updated;
  }

  /** Marks the alert as a false alarm — same terminal-state rules as
   * resolve, distinct status so the leaderboard/history can tell a real
   * emergency from a mistaken trigger. */
  async markFalseAlarm(actor: AuthenticatedUser, alertId: string, resolutionNotes?: string) {
    const alert = await this.getAlertOrThrow(alertId);
    if (alert.status === SOS_STATUS.RESOLVED || alert.status === SOS_STATUS.FALSE_ALARM) {
      throw new BadRequestException(`SOS alert is already in a terminal status: ${alert.status}`);
    }

    const updated = await this.prisma.sosAlert.update({
      where: { id: alertId },
      data: { status: SOS_STATUS.FALSE_ALARM, resolvedById: actor.id, resolvedAt: new Date(), resolutionNotes },
    });

    await this.audit.record({
      caseId: alert.caseId ?? undefined,
      actorId: actor.id,
      actorType: 'user',
      action: 'agent.sos_marked_false_alarm',
      metadata: { alertId },
    });

    return updated;
  }

  /** Escalates to the next channel in the chain: admin -> whatsapp ->
   * emergency_contact -> police. */
  async escalateSosAlert(actor: AuthenticatedUser, alertId: string, dto: EscalateSosDto) {
    const alert = await this.getAlertOrThrow(alertId);
    if (alert.status !== SOS_STATUS.ACTIVE && alert.status !== SOS_STATUS.ACKNOWLEDGED && alert.status !== SOS_STATUS.ESCALATED) {
      throw new BadRequestException(`Cannot escalate an SOS alert in status ${alert.status}`);
    }

    const nextLevel = alert.escalationLevel + 1;
    if (nextLevel > MAX_ESCALATION_LEVEL) {
      throw new BadRequestException('SOS alert has already been escalated to the maximum level');
    }

    const currentChannels = alert.escalatedChannels;
    const nextChannels = currentChannels.includes(dto.channel) ? currentChannels : [...currentChannels, dto.channel];

    const updated = await this.prisma.sosAlert.update({
      where: { id: alertId },
      data: { status: SOS_STATUS.ESCALATED, escalationLevel: nextLevel, escalatedChannels: nextChannels },
    });

    await this.audit.record({
      caseId: alert.caseId ?? undefined,
      actorId: actor.id,
      actorType: 'user',
      action: 'agent.sos_escalated',
      metadata: { alertId, channel: dto.channel, escalationLevel: nextLevel },
    });

    return updated;
  }

  async getActiveAlerts() {
    return this.prisma.sosAlert.findMany({
      where: { status: { in: [SOS_STATUS.ACTIVE, SOS_STATUS.ACKNOWLEDGED, SOS_STATUS.ESCALATED] } },
      include: { agent: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAlertHistory(actor: AuthenticatedUser, agentId?: string, limit = 50) {
    // A field agent may only ever see their own history; staff can filter
    // by any agent or see everything.
    const isStaff = actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN || actor.role === Role.CASE_MANAGER;
    let effectiveAgentId = agentId;
    if (!isStaff) {
      const ownAgent = await this.prisma.agent.findUnique({ where: { userId: actor.id } });
      if (!ownAgent) throw new ForbiddenException('Not authorised to view SOS alert history');
      effectiveAgentId = ownAgent.id;
    }

    return this.prisma.sosAlert.findMany({
      where: effectiveAgentId ? { agentId: effectiveAgentId } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private async getAlertOrThrow(alertId: string) {
    const alert = await this.prisma.sosAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException('SOS alert not found');
    return alert;
  }
}
