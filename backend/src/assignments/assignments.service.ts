import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssignmentRole, AssignmentStatus, CaseStatus, ProviderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CasesService } from '../cases/cases.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateAssignmentDto } from './dto/create-assignment.dto';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly casesService: CasesService,
  ) {}

  /** Vertical slice 3: Payment -> Assignment. */
  async createAssignment(actor: AuthenticatedUser, caseId: string, dto: CreateAssignmentDto) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (serviceCase.status !== CaseStatus.SCHEDULED) {
      throw new BadRequestException(`Cannot assign a case in status ${serviceCase.status}`);
    }

    if (dto.role === AssignmentRole.PROVIDER) {
      const provider = await this.prisma.provider.findUnique({ where: { id: dto.providerId } });
      if (!provider) throw new NotFoundException('Provider not found');
      if (provider.status !== ProviderStatus.VERIFIED && provider.status !== ProviderStatus.ACTIVE) {
        throw new BadRequestException('Provider is not yet verified for assignment');
      }
    } else if (dto.role === AssignmentRole.FIELD_AGENT) {
      const agent = await this.prisma.agent.findUnique({ where: { id: dto.agentId } });
      if (!agent || !agent.isActive) throw new NotFoundException('Agent not found or inactive');
    }

    const assignment = await this.prisma.assignment.create({
      data: {
        caseId,
        role: dto.role,
        agentId: dto.role === AssignmentRole.FIELD_AGENT ? dto.agentId : undefined,
        providerId: dto.role === AssignmentRole.PROVIDER ? dto.providerId : undefined,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
      },
    });

    await this.casesService.transitionCase(actor, caseId, CaseStatus.ASSIGNED, `${dto.role} assigned`);
    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'assignment.created',
      metadata: { assignmentId: assignment.id, role: dto.role, agentId: dto.agentId, providerId: dto.providerId },
    });

    return assignment;
  }

  /**
   * The field extension of the platform (Gate 1-16 working session, "Field
   * Agent Model") accepts their own assignment — this is what actually
   * kicks off execution (Assigned -> In Progress).
   */
  async acceptAssignment(actor: AuthenticatedUser, assignmentId: string) {
    const assignment = await this.requireOwnedAssignment(actor, assignmentId);

    if (assignment.status !== AssignmentStatus.OFFERED) {
      throw new BadRequestException(`Assignment already ${assignment.status.toLowerCase()}`);
    }

    const updated = await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.ACCEPTED, acceptedAt: new Date() },
    });

    if (assignment.case.status === CaseStatus.ASSIGNED) {
      await this.casesService.transitionCase(actor, assignment.caseId, CaseStatus.IN_PROGRESS, 'Assignment accepted');
    }

    await this.audit.record({
      caseId: assignment.caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'assignment.accepted',
      metadata: { assignmentId },
    });

    return updated;
  }

  /** Lets the assignee decline so staff can reassign rather than the case stalling. */
  async declineAssignment(actor: AuthenticatedUser, assignmentId: string) {
    const assignment = await this.requireOwnedAssignment(actor, assignmentId);

    const updated = await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.DECLINED },
    });

    if (assignment.case.status === CaseStatus.ASSIGNED) {
      await this.casesService.transitionCase(actor, assignment.caseId, CaseStatus.SCHEDULED, 'Assignment declined');
    }

    await this.audit.record({
      caseId: assignment.caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'assignment.declined',
      metadata: { assignmentId },
    });

    return updated;
  }

  /**
   * Section 5.4 Field Agent App workflow: Accept -> Navigate -> Check-in
   * (timestamp + location) -> Execute checklist. Timestamp is always
   * server-side (consistent with Section 8.4's evidence rule) — location
   * is whatever the client can provide (GPS coords, or a plain address
   * string if geolocation isn't available).
   */
  async checkIn(actor: AuthenticatedUser, assignmentId: string, location?: Record<string, unknown>) {
    const assignment = await this.requireOwnedAssignment(actor, assignmentId);
    if (assignment.status !== AssignmentStatus.ACCEPTED) {
      throw new BadRequestException('Must accept the assignment before checking in');
    }

    const updated = await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: { checkInAt: new Date(), checkInLocation: location as any },
    });

    await this.audit.record({
      caseId: assignment.caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'assignment.checked_in',
      metadata: { assignmentId, location },
    });

    return updated;
  }

  private async requireOwnedAssignment(actor: AuthenticatedUser, assignmentId: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { agent: true, provider: true, case: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const ownsAssignment =
      assignment.agent?.userId === actor.id || assignment.provider?.userId === actor.id;
    if (!ownsAssignment) throw new ForbiddenException('Not your assignment');

    return assignment;
  }
}
