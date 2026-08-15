// ═══════════════════════════════════════════════════════════════════════════════
// Admin Live Tracking
// GET — Mission track data or all active agent locations
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  getMissionTrack,
  getMissionTrackSummary,
  getActiveAgentLocations,
} from '@/lib/live-tracking';

// ─── GET: Mission Track or Active Agent Map ─────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const missionId = searchParams.get('missionId') || undefined;
    const agentId = searchParams.get('agentId') || undefined;

    // Single mission track
    if (missionId) {
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
    }

    // Active agent locations (live map view)
    const agents = await getActiveAgentLocations();

    // If agentId filter, narrow it down
    const filtered = agentId
      ? agents.filter((a) => a.agentId === agentId)
      : agents;

    return NextResponse.json({
      agents: filtered.map((a) => ({
        agentId: a.agentId,
        agentName: a.agentName,
        missionId: a.missionId,
        missionTitle: a.missionTitle,
        latitude: a.latitude,
        longitude: a.longitude,
        accuracy: a.accuracy,
        speed: a.speed,
        batteryLevel: a.batteryLevel,
        lastPingAt: a.lastPingAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN TRACKING] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
