import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AssignmentRole, AssignmentStatus, CaseStatus, ProviderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CasesService } from '../cases/cases.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { evaluateCheckIn, GEOFENCE_REJECTION_MESSAGES } from '../common/geofence/geofence';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly casesService: CasesService,
  ) {}

  /**
   * Vertical slice 3: Payment -> Assignment. Also the entry point for
   * Section 12 P1 "multi-provider coordination" — a case can carry more
   * than one active assignment (e.g. a field agent for the physical visit
   * *and* a lawyer for a title opinion), so this only requires the case to
   * already be scheduled-or-later, and only drives the ASSIGNED transition
   * on the *first* assignment. Later assignments join a case that's
   * already ASSIGNED/IN_PROGRESS without trying to re-transition it.
   */
  async createAssignment(actor: AuthenticatedUser, caseId: string, dto: CreateAssignmentDto) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: { customer: true },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');
    const assignableStatuses: CaseStatus[] = [CaseStatus.SCHEDULED, CaseStatus.ASSIGNED, CaseStatus.IN_PROGRESS];
    if (!assignableStatuses.includes(serviceCase.status)) {
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

    if (serviceCase.status === CaseStatus.SCHEDULED) {
      await this.casesService.transitionCase(actor, caseId, CaseStatus.ASSIGNED, `${dto.role} assigned`);
    }
    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'assignment.created',
      metadata: { assignmentId: assignment.id, role: dto.role, agentId: dto.agentId, providerId: dto.providerId },
    });
    await this.notifications.notify(
      serviceCase.customer.userId,
      'Someone has been assigned to your case',
      `We've assigned ${dto.role === 'FIELD_AGENT' ? 'a field agent' : 'a professional'} to ${serviceCase.caseNumber}. We'll update you once the visit is under way.`,
    );

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

    // location stays free-form for backward compatibility (a plain address
    // string wrapped in an object is still a valid check-in) — lat/lng/
    // accuracy/capturedAt are read out defensively when present, matching
    // the shape FieldForce's own check-in client sends.
    const lat = typeof location?.lat === 'number' ? location.lat : undefined;
    const lng = typeof location?.lng === 'number' ? location.lng : undefined;
    const accuracy = typeof location?.accuracy === 'number' ? location.accuracy : undefined;
    const capturedAt =
      typeof location?.capturedAt === 'string' || location?.capturedAt instanceof Date
        ? (location.capturedAt as string | Date)
        : undefined;

    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: assignment.caseId },
      select: {
        property: { select: { latitude: true, longitude: true } },
        asset: { select: { latitude: true, longitude: true } },
      },
    });
    const target = serviceCase?.property ?? serviceCase?.asset ?? null;

    const geofence = evaluateCheckIn({
      lat,
      lng,
      accuracy,
      capturedAt,
      targetLat: target?.latitude,
      targetLng: target?.longitude,
    });

    if (geofence.outcome === 'REJECTED') {
      await this.audit.record({
        caseId: assignment.caseId,
        actorId: actor.id,
        actorType: 'user',
        action: 'assignment.check_in_rejected',
        metadata: { assignmentId, reason: geofence.reason, distanceMeters: geofence.distanceMeters, location },
      });

      const message = GEOFENCE_REJECTION_MESSAGES[geofence.reason ?? ''] ?? 'Check-in could not be validated.';
      if (geofence.reason === 'INVALID_COORDINATES') throw new BadRequestException(message);
      if (geofence.reason === 'OUTSIDE_GEOFENCE') throw new ForbiddenException(message);
      throw new UnprocessableEntityException(message);
    }

    const updated = await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        checkInAt: new Date(),
        checkInLocation: location as any,
        checkInAccuracy: accuracy,
        geofenceResult: geofence.outcome,
        geofenceDistanceMeters: geofence.distanceMeters,
      },
    });

    await this.audit.record({
      caseId: assignment.caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'assignment.checked_in',
      metadata: { assignmentId, location, geofenceResult: geofence.outcome, distanceMeters: geofence.distanceMeters },
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
