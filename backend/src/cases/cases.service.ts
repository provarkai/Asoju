import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApprovalAction, AssignmentStatus, CaseStatus, CollaboratorRole, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { ConvertRequestDto } from './dto/convert-request.dto';
import { assertValidTransition } from './case-state-machine';
import { CHECKLIST_TEMPLATES } from './checklist-templates';
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

    // Section 6.1 — every service gets its own version of the standard
    // field checklist, seeded onto the case the moment it exists so the
    // Field Agent App always has one to execute against.
    const checklist = CHECKLIST_TEMPLATES[dto.serviceType];
    await this.prisma.caseTask.createMany({
      data: checklist.map((label, index) => ({ caseId: serviceCase.id, label, sortOrder: index })),
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

  private static readonly OPS_ROLES: Role[] = [
    Role.CASE_MANAGER,
    Role.RELATIONSHIP_MANAGER,
    Role.QUALITY_CONTROL,
    Role.FINANCE,
    Role.COMPLIANCE_RISK,
    Role.ADMIN,
    Role.SUPER_ADMIN,
  ];

  private static readonly CASE_QUEUE_SUMMARY = {
    customer: { select: { fullName: true, userId: true } },
    assignments: {
      where: {
        status: {
          in: [AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED, AssignmentStatus.IN_PROGRESS],
        },
      },
      include: {
        agent: { select: { fullName: true } },
        provider: { select: { fullName: true } },
      },
    },
    _count: { select: { riskFlags: true, incidents: true } },
  };

  async listCasesForUser(user: AuthenticatedUser) {
    if (user.role === Role.CUSTOMER) {
      const customer = await this.requireCustomerProfile(user.id);
      return this.prisma.serviceCase.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (user.role === Role.FIELD_AGENT || user.role === Role.PROVIDER) {
      // Section 5.4 Field Agent App "job list" — include just this
      // person's own assignment(s) on each case so the UI has the
      // assignment id/status without a second round trip per case.
      const ownAssignmentFilter = {
        OR: [{ agent: { userId: user.id } }, { provider: { userId: user.id } }],
      };
      return this.prisma.serviceCase.findMany({
        where: { assignments: { some: ownAssignmentFilter } },
        include: { assignments: { where: ownAssignmentFilter } },
        orderBy: { updatedAt: 'desc' },
      });
    }

    // Ops Control Centre "case queue" (Section 5.3) is an org-wide
    // operational view by design — every internal role needs to see new
    // and in-flight cases to triage/pick them up, not just ones they
    // already hold a collaborator record on. This is deliberately broader
    // than Non-Negotiable #6's case-scoped rule, which governs *acting on*
    // a specific case (CaseAccessGuard, still enforced on detail/mutation
    // endpoints below) — not read-only visibility of the queue itself.
    if (CasesService.OPS_ROLES.includes(user.role)) {
      return this.prisma.serviceCase.findMany({
        include: CasesService.CASE_QUEUE_SUMMARY,
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });
    }

    return [];
  }

  async getCaseDetail(caseId: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: {
        customer: { select: { fullName: true, userId: true } },
        tasks: { orderBy: { sortOrder: 'asc' } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        riskFlags: true,
        incidents: true,
        collaborators: { include: { user: { select: { email: true, role: true } } } },
        assignments: {
          include: {
            agent: { select: { fullName: true } },
            provider: { select: { fullName: true } },
          },
        },
        evidence: { include: { uploader: { select: { email: true } } } },
        reports: true,
        quotes: true,
        invoices: { include: { payments: true } },
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
    return this.applyTransition(caseId, toStatus, reason, actor.id, 'user');
  }

  /**
   * Same deterministic transition, but for a change driven by a verified
   * external event with no human actor behind it — e.g. a payment
   * provider's webhook (Non-Negotiable #4). `changedById`/`actorId` are
   * left null rather than pointed at a fake user, since AuditEvent.actorId
   * has a real foreign key to User.
   */
  async systemTransitionCase(caseId: string, toStatus: CaseStatus, reason?: string) {
    return this.applyTransition(caseId, toStatus, reason, undefined, 'system');
  }

  private async applyTransition(
    caseId: string,
    toStatus: CaseStatus,
    reason: string | undefined,
    actorId: string | undefined,
    actorType: 'user' | 'system',
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
        changedById: actorId,
        reason,
      },
    });

    await this.audit.record({
      caseId,
      actorId,
      actorType,
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
      // Nothing further requires human judgment once the customer has
      // approved the deliverable — move straight to Completed. Closing
      // (Completed -> Closed) stays a deliberate staff/finance action.
      await this.transitionCase(actor, caseId, CaseStatus.COMPLETED, 'Auto-completed after customer approval');
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

  /**
   * Self-service counterpart to addCollaborator: lets a staff member seen
   * browsing the org-wide queue (listCasesForUser) attach themselves to a
   * specific case — the "claim" action an Ops Console needs so triage
   * doesn't bottleneck on an admin. Only valid for roles that map onto a
   * CollaboratorRole; ADMIN/SUPER_ADMIN never need this since they bypass
   * CaseAccessGuard already.
   */
  async claimCase(actor: AuthenticatedUser, caseId: string) {
    const collaboratorRole = COLLABORATOR_ROLE_BY_USER_ROLE[actor.role];
    if (!collaboratorRole) {
      throw new BadRequestException('This role cannot claim cases');
    }
    return this.addCollaborator(actor, caseId, actor.id, collaboratorRole);
  }

  private async requireCustomerProfile(userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundException('No customer profile for this user');
    return customer;
  }
}
