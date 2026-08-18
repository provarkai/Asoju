import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EscalationReasonCategory, EscalationStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateEscalationDto } from './dto/create-escalation.dto';
import { AssignEscalationDto } from './dto/assign-escalation.dto';
import { ResolveEscalationDto } from './dto/resolve-escalation.dto';

// Same staff-role set as CasesController's OPS_ROLES (duplicated locally,
// same convention already used across this codebase — e.g.
// commerce.controller.ts's STAFF_QUOTE_ROLES vs.
// predictive-costing.controller.ts's copy of the same list — rather than
// a new shared-constants module).
const OPS_ROLES: Role[] = [
  Role.CASE_MANAGER,
  Role.RELATIONSHIP_MANAGER,
  Role.QUALITY_CONTROL,
  Role.FINANCE,
  Role.COMPLIANCE_RISK,
  Role.ADMIN,
  Role.SUPER_ADMIN,
];

// The only customer-safe fields — never internalReason, handoffSummary or
// assignedToId. Source spec §9: "Do not expose internal risk scores,
// thresholds or hidden rules."
const CUSTOMER_SAFE_SELECT = {
  id: true,
  reasonCategory: true,
  customerMessage: true,
  status: true,
  createdAt: true,
  resolvedAt: true,
} as const;

@Injectable()
export class EscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, caseId: string, dto: CreateEscalationDto) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const escalation = await this.prisma.escalation.create({
      data: {
        caseId,
        reasonCategory: dto.reasonCategory,
        internalReason: dto.internalReason,
        handoffSummary: dto.handoffSummary as any,
        customerMessage: dto.customerMessage,
      },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'escalation.created',
      metadata: { escalationId: escalation.id, reasonCategory: escalation.reasonCategory },
    });

    return escalation;
  }

  /**
   * docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 3 — the ESCALATE outcome
   * of AutomationEligibilityService, for a ServiceRequest that has no Case
   * yet (`caseId` stays null; `serviceRequestId` is the link instead).
   * System-attributed, not staff-attributed — there is no human actor
   * behind an automated decision. Never exposed as a public HTTP route;
   * AutomationEligibilityService is the only caller.
   */
  async createForServiceRequest(
    serviceRequestId: string,
    reasonCategory: EscalationReasonCategory,
    customerMessage: string,
    internalReason?: string,
  ) {
    const escalation = await this.prisma.escalation.create({
      data: { serviceRequestId, reasonCategory, customerMessage, internalReason },
    });

    await this.audit.record({
      actorType: 'system',
      action: 'escalation.created',
      metadata: { escalationId: escalation.id, reasonCategory, serviceRequestId },
    });

    return escalation;
  }

  /** Staff-only detail — every field, including internalReason/
   * handoffSummary. Distinct from listForCase below, which is the
   * customer-safe view. */
  async findOne(id: string) {
    const escalation = await this.prisma.escalation.findUnique({ where: { id } });
    if (!escalation) throw new NotFoundException('Escalation not found');
    return escalation;
  }

  /** Staff triage queue — optionally filtered by status. */
  async list(status?: EscalationStatus) {
    return this.prisma.escalation.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Customer-safe view for the case-detail screen — CaseAccessGuard
   * already restricts who can call this at all (customer who owns the
   * case, or staff); the field-level curation here is what keeps internal
   * detail out of a customer's response even though staff hit the same
   * endpoint. */
  async listForCase(caseId: string, viewerRole: Role) {
    const escalations = await this.prisma.escalation.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
    });
    if (OPS_ROLES.includes(viewerRole)) return escalations;
    return escalations.map((e) => Object.fromEntries(Object.keys(CUSTOMER_SAFE_SELECT).map((k) => [k, (e as any)[k]])));
  }

  async assign(actor: AuthenticatedUser, id: string, dto: AssignEscalationDto) {
    const escalation = await this.requireEscalation(id);
    const assignee = await this.prisma.user.findUnique({ where: { id: dto.assignedToId } });
    if (!assignee || !OPS_ROLES.includes(assignee.role)) {
      throw new BadRequestException('Escalations can only be assigned to operations staff');
    }

    const updated = await this.prisma.escalation.update({
      where: { id },
      data: { assignedToId: dto.assignedToId, status: EscalationStatus.REVIEWING },
    });

    await this.audit.record({
      caseId: escalation.caseId ?? undefined,
      actorId: actor.id,
      actorType: 'user',
      action: 'escalation.assigned',
      metadata: { escalationId: id, assignedToId: dto.assignedToId },
    });

    return updated;
  }

  async resolve(actor: AuthenticatedUser, id: string, dto: ResolveEscalationDto) {
    const escalation = await this.requireEscalation(id);
    if (escalation.status === EscalationStatus.RESOLVED || escalation.status === EscalationStatus.CANCELLED) {
      throw new BadRequestException(`Escalation is already ${escalation.status.toLowerCase()}`);
    }

    const updated = await this.prisma.escalation.update({
      where: { id },
      data: { status: EscalationStatus.RESOLVED, resolvedAt: new Date(), resolutionNotes: dto.resolutionNotes },
    });

    await this.audit.record({
      caseId: escalation.caseId ?? undefined,
      actorId: actor.id,
      actorType: 'user',
      action: 'escalation.resolved',
      metadata: { escalationId: id },
    });

    return updated;
  }

  async cancel(actor: AuthenticatedUser, id: string, reason?: string) {
    const escalation = await this.requireEscalation(id);
    if (escalation.status === EscalationStatus.RESOLVED || escalation.status === EscalationStatus.CANCELLED) {
      throw new BadRequestException(`Escalation is already ${escalation.status.toLowerCase()}`);
    }

    const updated = await this.prisma.escalation.update({
      where: { id },
      data: { status: EscalationStatus.CANCELLED, resolvedAt: new Date(), resolutionNotes: reason },
    });

    await this.audit.record({
      caseId: escalation.caseId ?? undefined,
      actorId: actor.id,
      actorType: 'user',
      action: 'escalation.cancelled',
      metadata: { escalationId: id },
    });

    return updated;
  }

  private async requireEscalation(id: string) {
    const escalation = await this.prisma.escalation.findUnique({ where: { id } });
    if (!escalation) throw new NotFoundException('Escalation not found');
    return escalation;
  }
}
