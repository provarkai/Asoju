import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAgentIdFromRequest } from '@/lib/auth';
import {
  validateGeofence,
  parseGeofenceRule,
  type GpsValidationResult,
} from '@/lib/gps-geofence';
import {
  validateTransition,
  type TransitionResult,
  TERMINAL_STATES,
} from '@/lib/mission-state-machine';
import { sendMissionArrivedNotification } from '@/lib/whatsapp-gateway';

// ─── POST /api/missions/checkin ────────────────────────────────────────
// GPS Check-in with full P0.4 validation → P0.3 state machine transition → ON_SITE
export async function POST(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { caseId, lat, lng, accuracy, capturedAt } = await request.json();

    if (!caseId || lat === undefined || lng === undefined) {
      return NextResponse.json(
        { error: 'caseId, lat, lng are required' },
        { status: 400 },
      );
    }

    // Get the mission and verify ownership
    const mission = await db.mission.findUnique({ where: { caseId } });
    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }
    if (mission.agentId !== agentId) {
      return NextResponse.json({ error: 'AGENT_OWNERSHIP_REQUIRED' }, { status: 403 });
    }

    // Check current state allows CHECK_IN (must be EN_ROUTE or PAUSED)
    if (mission.workflowState !== 'EN_ROUTE' && mission.workflowState !== 'PAUSED' && mission.workflowState !== 'ESCALATED') {
      return NextResponse.json(
        {
          error: 'INVALID_TRANSITION',
          message: `GPS check-in requires EN_ROUTE state. Current state: ${mission.workflowState}`,
          currentState: mission.workflowState,
        },
        { status: 422 },
      );
    }

    // Load target coordinates from mission locationSnapshot (NOT hardcoded)
    // Fallback to case locationLat/locationLng if not available
    let targetLat: number | null = null;
    let targetLng: number | null = null;

    try {
      const locationSnapshot = JSON.parse(mission.locationSnapshot || '{}');
      if (locationSnapshot.lat && locationSnapshot.lng) {
        targetLat = locationSnapshot.lat;
        targetLng = locationSnapshot.lng;
      }
    } catch { /* ignore parse errors */ }

    // Fallback: try loading from the related case
    if (targetLat === null || targetLng === null) {
      const case_ = await db.case.findUnique({
        where: { caseNumber: mission.caseId },
        select: { locationLat: true, locationLng: true },
      });
      if (case_?.locationLat && case_?.locationLng) {
        targetLat = case_.locationLat;
        targetLng = case_.locationLng;
      }
    }

    // Last fallback: use demo coordinates (for development/testing)
    if (targetLat === null || targetLng === null) {
      targetLat = 6.4281;
      targetLng = 3.4219;
    }

    // Parse geofence rule from mission or use default
    const geofenceRule = parseGeofenceRule(mission.lga); // lga field used for geofence rule in prototype
    const geofenceRadius = geofenceRule.type === 'RADIUS' ? geofenceRule.radiusMeters : 100;

    // Full P0.4 validation
    const validationResult = validateGeofence({
      agentLat: lat,
      agentLng: lng,
      accuracy: accuracy ?? 999,
      capturedAt: capturedAt || new Date().toISOString(),
      targetLat,
      targetLng,
      geofenceRadius,
    });

    // Determine exception code for the GPS check record
    const exceptionCode = validationResult.valid ? null :
      validationResult.reason === 'INVALID_COORDINATES' ? 'INVALID_COORDS' :
      validationResult.reason === 'ACCURACY_TOO_LOW' ? 'LOW_ACCURACY' :
      validationResult.reason === 'LOCATION_STALE' ? 'STALE_LOCATION' :
      validationResult.reason === 'OUTSIDE_GEOFENCE' ? 'OUTSIDE_RADIUS' :
      validationResult.reason;

    // Create GpsCheck record (always, for audit trail)
    await db.gpsCheck.create({
      data: {
        missionId: mission.id,
        agentId,
        latitude: lat,
        longitude: lng,
        accuracy: accuracy || null,
        targetLat,
        targetLng,
        geofenceRule: `RADIUS_${geofenceRadius}M`,
        distanceFromTarget: validationResult.valid
          ? Math.round(validationResult.distance * 100) / 100
          : (validationResult.distance ? Math.round(validationResult.distance * 100) / 100 : null),
        result: validationResult.result,
        exceptionCode,
        exceptionReason: validationResult.valid ? null : validationResult.reason,
      },
    });

    if (!validationResult.valid) {
      // Create AuditEvent for failed checkin
      await db.auditEvent.create({
        data: {
          actorType: 'AGENT',
          actorId: agentId,
          action: 'GPS_CHECKIN_FAILED',
          entityType: 'Mission',
          entityId: mission.id,
          metadata: JSON.stringify({
            reason: validationResult.reason,
            distance: validationResult.distance ? Math.round(validationResult.distance) : null,
            accuracy,
          }),
          correlationId: caseId,
        },
      });

      // Return specific error based on rejection reason
      const statusMap: Record<string, number> = {
        INVALID_COORDINATES: 400,
        ACCURACY_TOO_LOW: 422,
        LOCATION_STALE: 422,
        OUTSIDE_GEOFENCE: 403,
        MISSING_TIMESTAMP: 400,
      };

      return NextResponse.json(
        {
          success: false,
          error: `GPS_${validationResult.reason}`,
          message: getGpsErrorMessage(validationResult.reason, validationResult.distance),
          reason: validationResult.reason,
          distance: validationResult.distance ? Math.round(validationResult.distance) : null,
          requiredRadius: geofenceRadius,
          result: validationResult.result,
        },
        { status: statusMap[validationResult.reason] || 403 },
      );
    }

    // Validate state machine transition: EN_ROUTE → ON_SITE
    const transitionValidation = validateTransition(
      mission.workflowState as any,
      'CHECK_IN',
      'AGENT',
    );

    if (!transitionValidation.success) {
      return NextResponse.json(
        {
          error: transitionValidation.error,
          message: transitionValidation.message,
          currentState: mission.workflowState,
        },
        { status: transitionValidation.error === 'UNAUTHORIZED_TRANSITION' ? 403 : 422 },
      );
    }

    // Race-safe atomic update: only transition if state hasn't changed
    const updateResult = await db.mission.updateMany({
      where: {
        caseId,
        workflowState: mission.workflowState,
      },
      data: { workflowState: transitionValidation.newState },
    });

    if (updateResult.count === 0) {
      return NextResponse.json(
        {
          error: 'MISSION_STATE_CONFLICT',
          message: 'Mission state was modified concurrently. Please refresh and try again.',
        },
        { status: 409 },
      );
    }

    // Fetch the updated mission
    const updatedMission = await db.mission.findUnique({ where: { caseId } });

    // Queue for offline sync
    const idempotencyKey = `checkin-${caseId}`;
    await db.offlineQueue.upsert({
      where: { idempotencyKey },
      create: {
        agentId,
        missionId: caseId,
        operationType: 'GPS_CHECKIN',
        payload: JSON.stringify({ caseId, lat, lng, accuracy }),
        idempotencyKey,
        status: 'SYNCED',
        syncedAt: new Date(),
      },
      update: { status: 'SYNCED', syncedAt: new Date() },
    });

    // Create AuditEvent for successful checkin
    await db.auditEvent.create({
      data: {
        actorType: 'AGENT',
        actorId: agentId,
        action: 'GPS_CHECKIN_PASSED',
        entityType: 'Mission',
        entityId: mission.id,
        metadata: JSON.stringify({
          distance: Math.round(validationResult.distance),
          accuracy,
          geofenceRadius,
        }),
        correlationId: caseId,
      },
    });

    // Family Connect milestone 1/3: "agent arrives" — best-effort, must
    // never fail the check-in itself if the notification queue hiccups.
    try {
      await sendMissionArrivedNotification(caseId);
    } catch (notifyError) {
      console.warn(`[Checkin] Could not send arrival notification for case ${caseId}:`, notifyError);
    }

    return NextResponse.json({
      success: true,
      message: 'GPS check-in successful',
      distance: Math.round(validationResult.distance),
      result: validationResult.result,
      previousState: mission.workflowState,
      currentState: transitionValidation.newState,
      mission: updatedMission,
    });
  } catch (error) {
    console.error('POST /api/missions/checkin error:', error);
    return NextResponse.json(
      { error: 'Failed to process GPS check-in' },
      { status: 500 },
    );
  }
}

// ─── Error Messages ──────────────────────────────────────────────────────

function getGpsErrorMessage(
  reason: string,
  distance?: number
): string {
  switch (reason) {
    case 'INVALID_COORDINATES':
      return 'Invalid GPS coordinates provided. Please ensure your GPS is enabled and try again.';
    case 'ACCURACY_TOO_LOW':
      return 'GPS accuracy is too low. Please wait for a better signal and try again.';
    case 'LOCATION_STALE':
      return 'Location data is too old. Please refresh your location and try again.';
    case 'OUTSIDE_GEOFENCE':
      return `You are ${distance ? Math.round(distance) + 'm' : ''} away from the site. Please move within the required radius to check in.`;
    case 'MISSING_TIMESTAMP':
      return 'Location capture timestamp is missing. Please try again.';
    default:
      return 'GPS check-in failed. Please try again.';
  }
}
