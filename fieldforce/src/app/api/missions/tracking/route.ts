// ═══════════════════════════════════════════════════════════════════════════════
// Agent-Facing Live GPS Tracking
// POST — Report live location during a mission
// GET  — Retrieve mission track data with summary
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { getAgentIdFromRequest } from '@/lib/auth';
import { reportLiveLocation, getMissionTrack, getMissionTrackSummary } from '@/lib/live-tracking';

// ─── POST: Report Live Location ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { missionId, latitude, longitude, accuracy, speed, heading, batteryLevel } = body;

    // Validate required fields
    if (!missionId) {
      return NextResponse.json({ error: 'missionId is required' }, { status: 400 });
    }
    if (latitude === undefined || longitude === undefined) {
      return NextResponse.json(
        { error: 'latitude and longitude are required' },
        { status: 400 },
      );
    }

    // Validate coordinate ranges
    if (typeof latitude !== 'number' || latitude < -90 || latitude > 90 || isNaN(latitude)) {
      return NextResponse.json({ error: 'Invalid latitude' }, { status: 400 });
    }
    if (typeof longitude !== 'number' || longitude < -180 || longitude > 180 || isNaN(longitude)) {
      return NextResponse.json({ error: 'Invalid longitude' }, { status: 400 });
    }

    const location = await reportLiveLocation({
      missionId,
      agentId,
      latitude,
      longitude,
      accuracy: accuracy !== undefined ? Number(accuracy) : undefined,
      speed: speed !== undefined ? Number(speed) : undefined,
      heading: heading !== undefined ? Number(heading) : undefined,
      batteryLevel: batteryLevel !== undefined ? Number(batteryLevel) : undefined,
    });

    return NextResponse.json({
      message: 'Location recorded',
      locationId: location.id,
      createdAt: location.createdAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof Error) {
      // Validation errors from live-tracking (invalid coords, accuracy threshold)
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[MISSION TRACKING] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── GET: Mission Track Data ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const agentId = getAgentIdFromRequest(request);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const missionId = searchParams.get('missionId');

    if (!missionId) {
      return NextResponse.json({ error: 'missionId is required' }, { status: 400 });
    }

    // Fetch track and summary in parallel
    const [track, summary] = await Promise.all([
      getMissionTrack(missionId),
      getMissionTrackSummary(missionId),
    ]);

    return NextResponse.json({
      track: track.map((p) => ({
        id: p.id,
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy,
        speed: p.speed,
        heading: p.heading,
        batteryLevel: p.batteryLevel,
        createdAt: p.createdAt.toISOString(),
      })),
      summary: summary
        ? {
            missionId: summary.missionId,
            agentId: summary.agentId,
            pointCount: summary.pointCount,
            totalDistanceMeters: summary.totalDistanceMeters,
            totalDurationSeconds: summary.totalDurationSeconds,
            startTime: summary.startTime?.toISOString() ?? null,
            endTime: summary.endTime?.toISOString() ?? null,
            averageSpeedMps: summary.averageSpeedMps,
            maxSpeedMps: summary.maxSpeedMps,
          }
        : null,
    });
  } catch (error) {
    console.error('[MISSION TRACKING] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
