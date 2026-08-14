import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { validateCoordinates, haversineDistanceMeters, MAX_ACCURACY_METERS } from '../common/geofence/geofence';

export interface ReportLocationInput {
  lat: number;
  lng: number;
  accuracy?: number;
  capturedAt?: string;
}

/**
 * Continuous location tracking while an assignment is active — distinct
 * from AssignmentsService.checkIn's single point-in-time, geofence-gated
 * record. Ported from FieldForce's live-tracking.ts.
 *
 * Deliberately more permissive than check-in: background pings from a
 * moving field agent are noisier than a deliberate check-in tap, so a
 * single low-accuracy reading doesn't reject the whole ping — only
 * structurally invalid coordinates do. Accuracy is stored and filtered
 * out of distance/path calculations instead, which is where bad readings
 * actually cause harm (inflating a walked distance with GPS jitter).
 */
@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireActiveOwnedAssignment(actor: AuthenticatedUser, assignmentId: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { agent: true, provider: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const owns = assignment.agent?.userId === actor.id || assignment.provider?.userId === actor.id;
    if (!owns) throw new ForbiddenException('Not your assignment');

    if (!assignment.checkInAt) {
      throw new BadRequestException('Must check in before reporting a location');
    }
    if (assignment.completedAt) {
      throw new BadRequestException('Assignment is already completed — no further location pings accepted');
    }

    return assignment;
  }

  async reportLocation(actor: AuthenticatedUser, assignmentId: string, input: ReportLocationInput) {
    const assignment = await this.requireActiveOwnedAssignment(actor, assignmentId);
    if (!assignment.agentId) {
      // PROVIDER assignments have no Agent row to attach a ping to —
      // live tracking is a field-agent capability, not a provider one.
      throw new BadRequestException('Live tracking applies to field agent assignments only');
    }

    if (!validateCoordinates(input.lat, input.lng)) {
      throw new BadRequestException('Invalid GPS coordinates');
    }

    const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
    if (Number.isNaN(capturedAt.getTime())) {
      throw new BadRequestException('Invalid capturedAt timestamp');
    }

    return this.prisma.locationPing.create({
      data: {
        assignmentId,
        agentId: assignment.agentId,
        latitude: input.lat,
        longitude: input.lng,
        accuracy: input.accuracy,
        capturedAt,
      },
    });
  }

  /** Assignment's own agent, or ADMIN/SUPER_ADMIN, can view its path.
   * Cumulative distance skips any leg where either endpoint's accuracy is
   * missing or worse than MAX_ACCURACY_METERS, so a noisy reading doesn't
   * inflate the total. */
  async getAssignmentTrack(actor: AuthenticatedUser, assignmentId: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { agent: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const isOps = actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN;
    const ownsAssignment = assignment.agent?.userId === actor.id;
    if (!isOps && !ownsAssignment) {
      throw new ForbiddenException('Not authorised to view this assignment’s track');
    }

    const pings = await this.prisma.locationPing.findMany({
      where: { assignmentId },
      orderBy: { capturedAt: 'asc' },
    });

    let totalDistanceMeters = 0;
    for (let i = 1; i < pings.length; i++) {
      const prev = pings[i - 1];
      const curr = pings[i];
      const prevReliable = prev.accuracy !== null && prev.accuracy <= MAX_ACCURACY_METERS;
      const currReliable = curr.accuracy !== null && curr.accuracy <= MAX_ACCURACY_METERS;
      if (!prevReliable || !currReliable) continue;

      totalDistanceMeters += haversineDistanceMeters(
        { lat: prev.latitude, lng: prev.longitude },
        { lat: curr.latitude, lng: curr.longitude },
      );
    }

    const durationSeconds =
      pings.length >= 2
        ? Math.round((pings[pings.length - 1].capturedAt.getTime() - pings[0].capturedAt.getTime()) / 1000)
        : 0;

    return {
      assignmentId,
      pointCount: pings.length,
      totalDistanceMeters: Math.round(totalDistanceMeters),
      durationSeconds,
      pings: pings.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy,
        capturedAt: p.capturedAt,
      })),
    };
  }

  /** Ops-facing feed: every currently-active assignment (checked in, not
   * yet completed) with its most recent known location — the latest
   * LocationPing if one exists, falling back to the check-in point
   * itself if the agent hasn't sent a live ping yet. */
  async getActiveAgentLocations() {
    const activeAssignments = await this.prisma.assignment.findMany({
      where: { checkInAt: { not: null }, completedAt: null, agentId: { not: null } },
      include: {
        agent: { select: { id: true, fullName: true } },
        case: { select: { id: true, caseNumber: true } },
        locationPings: { orderBy: { capturedAt: 'desc' }, take: 1 },
      },
    });

    return activeAssignments.map((assignment) => {
      const latestPing = assignment.locationPings[0];
      const checkIn = assignment.checkInLocation as { lat?: number; lng?: number } | null;

      return {
        assignmentId: assignment.id,
        agentId: assignment.agent?.id ?? null,
        agentName: assignment.agent?.fullName ?? null,
        caseId: assignment.case.id,
        caseNumber: assignment.case.caseNumber,
        latitude: latestPing?.latitude ?? checkIn?.lat ?? null,
        longitude: latestPing?.longitude ?? checkIn?.lng ?? null,
        lastSeenAt: latestPing?.capturedAt ?? assignment.checkInAt,
        source: latestPing ? 'LIVE_PING' : 'CHECK_IN',
      };
    });
  }
}
