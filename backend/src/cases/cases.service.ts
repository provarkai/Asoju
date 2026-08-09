import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApprovalAction, CaseStatus, CollaboratorRole, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { ConvertRequestDto } from './dto/convert-request.dto';
import { assertValidTransition } from './case-state-machine';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const CASE_NUMBER_PREFIX = 'ASJ';

// Staff roles that double as case-scoped collaborator roles (Section 4).
// ADMIN/SUPER_ADMIN are excluded — they already bypass CaseAccessGuard.
const COLLABORATOR_ROLE_BY_USER_ROLE: Partial<Record<Role, CollaboratorRole>> = {
  [Role.RELATIONSHIP_MANAGER]: CollaboratorRole.RELATIONSHIP_MANAGER,
  [Role.CASE_MANAGER]: CollaboratorRole.CASE_MANAGER,
  [Role.QUALITY_CONTROL]: CollaboratorRole.QUALITY_CONTROL,
  [Role.FINANCE]: CollaboratorRole.FINANCE,
  [Role.COMPLIANCE_RISK]: CollaboratorRole.COMPLIANCE_RISK,
};

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -- Service requests (pre-case intake) ------------------------------

  async createServiceRequest(user: AuthenticatedUser, dto: CreateServiceRequestDto) {
    const customer = await this.requireCustomerProfile(user.id);

    const request = await this.prisma.serviceRequest.create({
      data: {
        customerId: customer.id,
        rawDescription: dto.rawDescription,
        location: dto.location,
        channel: dto.channel,
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'service_request.created',
      metadata: { serviceRequestId: request.id, channel: dto.channel },
    });

    return request;
  }

  async listServiceRequests(user: AuthenticatedUser) {
    if (user.role === Role.CUSTOMER) {
      const customer = await this.requireCustomerProfile(user.id);
      return this.prisma.serviceRequest.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
      });
    }
    // Staff: unconverted requests are the triage queue.
    return this.prisma.serviceRequest.findMany({
      where: { convertedCaseId: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Vertical slice 1: Request -> Case. Converts a triaged ServiceRequest
   * into a ServiceCase with no manual re-entry of what's already known.
   * Deterministic — called by staff, or by a validated AI tool-call, never
   * by the LLM writing to the database directly (Section 7.6).
   */
  async convertToCase(actor: AuthenticatedUser, requestId: string, dto: ConvertRequestDto) {
    const request = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Service request not found');
    if (request.convertedCaseId) {
      throw new NotFoundException('Service request has already been converted');
    }

    const created = await this.prisma.serviceCase.create({
      data: {
        // Placeholder, unique on its own — replaced with the real
        // ASJ-###### number below once we know the reserved `seq`.
        caseNumber: `PENDING-${randomUUID()}`,
        customerId: request.customerId,
        serviceType: dto.serviceType,
        description: dto.description,
        location: dto.location,
        priority: dto.priority,
        riskLevel: dto.riskLevel,
        tier: dto.tier,
        status: CaseStatus.DRAFT,
        originRequest: { connect: { id: request.id } },
      },
    });

    const caseNumber = `${CASE_NUMBER_PREFIX}-${String(created.seq).padStart(6, '0')}`;
    const serviceCase = await this.prisma.serviceCase.update({
      where: { id: created.id },
      data: { caseNumber },
    });

    await this.prisma.caseStatusHistory.create({
      data: { caseId: serviceCase.id, toStatus: CaseStatus.DRAFT, changedById: actor.id },
    });

    // The staff member who triages a request into a case needs a real,
    // case-scoped reason to act on it afterwards (Non-Negotiable #6) — role
    // membership alone won't pass CaseAccessGuard. Attach them here rather
    // than leaving every case they create inaccessible to them.
    const collaboratorRole = COLLABORATOR_ROLE_BY_USER_ROLE[actor.role];
    if (collaboratorRole) {
      await this.prisma.caseCollaborator.create({
        data: { caseId: serviceCase.id, userId: actor.id, role: collaboratorRole },
      });
    }

    await this.audit.record({
      caseId: serviceCase.id,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.created_from_request',
      metadata: { serviceRequestId: request.id },
    });

    return serviceCase;
  }

  // -- Cases -------------------------------------------------------------

  async listCasesForUser(user: AuthenticatedUser) {
    if (user.role === Role.CUSTOMER) {
      const customer = await this.requireCustomerProfile(user.id);
      return this.prisma.serviceCase.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (user.role === Role.FIELD_AGENT || user.role === Role.PROVIDER) {
      return this.prisma.serviceCase.findMany({
        where: {
          assignments: {
            some: {
              OR: [{ agent: { userId: user.id } }, { provider: { userId: user.id } }],
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
    }

    if (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN) {
      return this.prisma.serviceCase.findMany({ orderBy: { updatedAt: 'desc' }, take: 200 });
    }

    // Other staff roles (RM/Case Manager/QC/Finance/Compliance): only
    // cases they are explicitly attached to (Non-Negotiable #6).
    return this.prisma.serviceCase.findMany({
      where: { collaborators: { some: { userId: user.id } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getCaseDetail(caseId: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        riskFlags: true,
        assignments: true,
        evidence: true,
        reports: true,
        quotes: true,
        approvals: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');
    return serviceCase;
  }

  /**
   * The only path by which a case's status may change. Validates against
   * the deterministic state machine, writes the status-history row, and
   * appends an audit event — every transition is fully traceable
   * (Non-Negotiables #9, #10).
   */
  async transitionCase(
    actor: AuthenticatedUser,
    caseId: string,
    toStatus: CaseStatus,
    reason?: string,
  ) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');

    assertValidTransition(serviceCase.status, toStatus);

    const updated = await this.prisma.serviceCase.update({
      where: { id: caseId },
      data: { status: toStatus },
    });

    await this.prisma.caseStatusHistory.create({
      data: {
        caseId,
        fromStatus: serviceCase.status,
        toStatus,
        changedById: actor.id,
        reason,
      },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.status_transitioned',
      metadata: { from: serviceCase.status, to: toStatus, reason },
    });

    return updated;
  }

  /** Section 5.1 — Approve / Request clarification / Request additional work / Escalate. */
  async recordApproval(actor: AuthenticatedUser, caseId: string, action: ApprovalAction, note?: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const approval = await this.prisma.approval.create({
      data: { caseId, byUserId: actor.id, action, note },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.approval_recorded',
      metadata: { action, note },
    });

    // Deterministic follow-on transitions driven by the approval action.
    if (action === ApprovalAction.APPROVED && serviceCase.status === CaseStatus.CUSTOMER_REVIEW) {
      await this.transitionCase(actor, caseId, CaseStatus.APPROVED, 'Customer approved');
    } else if (
      action === ApprovalAction.REQUEST_ADDITIONAL_WORK &&
      serviceCase.status === CaseStatus.CUSTOMER_REVIEW
    ) {
      await this.transitionCase(actor, caseId, CaseStatus.ADDITIONAL_WORK, note ?? 'Customer requested additional work');
    }

    return approval;
  }

  /** Section 5.3 — Operations Control Centre: assign/reassign staff onto a case. */
  async addCollaborator(actor: AuthenticatedUser, caseId: string, userId: string, role: CollaboratorRole) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const collaborator = await this.prisma.caseCollaborator.upsert({
      where: { caseId_userId_role: { caseId, userId, role } },
      update: {},
      create: { caseId, userId, role },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.collaborator_added',
      metadata: { userId, role },
    });

    return collaborator;
  }

  private async requireCustomerProfile(userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundException('No customer profile for this user');
    return customer;
  }
}
