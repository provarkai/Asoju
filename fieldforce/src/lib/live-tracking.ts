// ═══════════════════════════════════════════════════════════════════════════════
// ASOJU FieldForce — Real-time GPS Tracking
// ═══════════════════════════════════════════════════════════════════════════════
//
// Manages live GPS location data from agents during active missions.
// Agents ping their location periodically; this library stores pings,
// retrieves mission tracks, and calculates path distances.
//
// Data lifecycle:
//   - Location pings are stored in LiveLocation table
//   - Old pings (>24h by default) are cleaned up automatically
//   - Path data is computed on demand from ordered location history
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db'
import { haversineDistance } from '@/lib/gps-geofence'

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CLEANUP_HOURS = 24
const MAX_PING_RATE_MS = 5_000 // Minimum 5 seconds between pings per agent
const MAX_ACCURACY_THRESHOLD = 100 // Reject pings with accuracy > 100m

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReportLiveLocationInput {
  missionId: string
  agentId: string
  latitude: number
  longitude: number
  accuracy?: number
  speed?: number
  heading?: number
  batteryLevel?: number
}

export interface LocationPoint {
  id: string
  missionId: string
  agentId: string
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  batteryLevel: number | null
  createdAt: Date
}

export interface PathPoint extends LocationPoint {
 distanceFromPrevious: number | null  // meters
  totalDistance: number                   // cumulative meters from first point
  durationFromPrevious: number | null    // seconds
}

export interface MissionTrackSummary {
  missionId: string
  agentId: string
  pointCount: number
  totalDistanceMeters: number
  totalDurationSeconds: number
  startTime: Date | null
  endTime: Date | null
  averageSpeedMps: number | null
  maxSpeedMps: number | null
}

export interface AgentLocationLatest {
  agentId: string
  agentName: string
  missionId: string
  missionTitle: string
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  batteryLevel: number | null
  lastPingAt: Date
}

// ─── Core: Report Live Location ─────────────────────────────────────────────

export async function reportLiveLocation(input: ReportLiveLocationInput) {
  // Validate coordinates
  if (
    input.latitude < -90 ||
    input.latitude > 90 ||
    isNaN(input.latitude)
  ) {
    throw new Error(`Invalid latitude: ${input.latitude}`)
  }
  if (
    input.longitude < -180 ||
    input.longitude > 180 ||
    isNaN(input.longitude)
  ) {
    throw new Error(`Invalid longitude: ${input.longitude}`)
  }

  // Reject low-accuracy pings
  if (input.accuracy !== undefined && input.accuracy > MAX_ACCURACY_THRESHOLD) {
    throw new Error(
      `GPS accuracy ${input.accuracy}m exceeds threshold ${MAX_ACCURACY_THRESHOLD}m`
    )
  }

  // Rate limit: check last ping time for this agent
  const lastPing = await db.liveLocation.findFirst({
    where: { agentId: input.agentId },
    orderBy: { createdAt: 'desc' },
  })

  if (lastPing) {
    const elapsed = Date.now() - lastPing.createdAt.getTime()
    if (elapsed < MAX_PING_RATE_MS) {
      // Silently skip this ping — too frequent
      return lastPing
    }
  }

  // Store the location ping
  const location = await db.liveLocation.create({
    data: {
      missionId: input.missionId,
      agentId: input.agentId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy ?? null,
      speed: input.speed ?? null,
      heading: input.heading ?? null,
      batteryLevel: input.batteryLevel ?? null,
    },
  })

  // Clean up old locations in the background (fire-and-forget)
  cleanOldLocations(DEFAULT_CLEANUP_HOURS).catch((err) => {
    console.warn(`[LiveTracking] Background cleanup failed:`, err)
  })

  return location
}

// ─── Get Mission Track ──────────────────────────────────────────────────────

export async function getMissionTrack(
  missionId: string,
  since?: Date
) {
  const where: {
    missionId: string
    createdAt?: { gte: Date }
  } = { missionId }

  if (since) {
    where.createdAt = { gte: since }
  }

  return db.liveLocation.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  })
}

// ─── Get Latest Agent Location ─────────────────────────────────────────────

export async function getLatestAgentLocation(agentId: string) {
  return db.liveLocation.findFirst({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
  })
}

// ─── Get Active Agent Locations ────────────────────────────────────────────

export async function getActiveAgentLocations(): Promise<AgentLocationLatest[]> {
  // Get missions that are in active states (agent is in the field)
  const activeMissions = await db.mission.findMany({
    where: {
      workflowState: {
        in: [
          'EN_ROUTE',
          'ON_SITE',
          'CHECKED_IN',
          'EXECUTING',
          'PAUSED',
          'ESCALATED',
        ],
      },
    },
    select: {
      id: true,
      title: true,
      agentId: true,
      agent: {
        select: {
          displayName: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  })

  if (activeMissions.length === 0) return []

  // For each active mission, get the latest location ping
  const results: AgentLocationLatest[] = []

  for (const mission of activeMissions) {
    const latest = await db.liveLocation.findFirst({
      where: { missionId: mission.id },
      orderBy: { createdAt: 'desc' },
    })

    if (latest) {
      const agentName =
        mission.agent?.displayName ||
        `${mission.agent?.firstName || ''} ${mission.agent?.lastName || ''}`.trim() ||
        'Unknown Agent'

      results.push({
        agentId: mission.agentId,
        agentName,
        missionId: mission.id,
        missionTitle: mission.title,
        latitude: latest.latitude,
        longitude: latest.longitude,
        accuracy: latest.accuracy,
        speed: latest.speed,
        batteryLevel: latest.batteryLevel,
        lastPingAt: latest.createdAt,
      })
    }
  }

  return results
}

// ─── Calculate Mission Path ────────────────────────────────────────────────

export async function calculateMissionPath(missionId: string): Promise<PathPoint[]> {
  const locations = await db.liveLocation.findMany({
    where: { missionId },
    orderBy: { createdAt: 'asc' },
  })

  if (locations.length === 0) return []

  let cumulativeDistance = 0
  const pathPoints: PathPoint[] = locations.map((loc, index) => {
    let distanceFromPrevious: number | null = null
    let durationFromPrevious: number | null = null

    if (index > 0) {
      const prev = locations[index - 1]
      distanceFromPrevious = haversineDistance(
        prev.latitude,
        prev.longitude,
        loc.latitude,
        loc.longitude
      )
      durationFromPrevious =
        (loc.createdAt.getTime() - prev.createdAt.getTime()) / 1000
      cumulativeDistance += distanceFromPrevious
    }

    return {
      ...loc,
      distanceFromPrevious,
      totalDistance: cumulativeDistance,
      durationFromPrevious,
    }
  })

  return pathPoints
}

// ─── Get Mission Distance ──────────────────────────────────────────────────

export async function getMissionDistance(missionId: string): Promise<number> {
  const locations = await db.liveLocation.findMany({
    where: { missionId },
    orderBy: { createdAt: 'asc' },
  })

  if (locations.length < 2) return 0

  let totalDistance = 0
  for (let i = 1; i < locations.length; i++) {
    const prev = locations[i - 1]
    const curr = locations[i]
    totalDistance += haversineDistance(
      prev.latitude,
      prev.longitude,
      curr.latitude,
      curr.longitude
    )
  }

  return totalDistance
}

// ─── Get Mission Track Summary ─────────────────────────────────────────────

export async function getMissionTrackSummary(
  missionId: string
): Promise<MissionTrackSummary | null> {
  const locations = await db.liveLocation.findMany({
    where: { missionId },
    orderBy: { createdAt: 'asc' },
  })

  if (locations.length === 0) return null

  let totalDistance = 0
  let maxSpeed: number | null = null

  for (let i = 1; i < locations.length; i++) {
    const prev = locations[i - 1]
    const curr = locations[i]
    totalDistance += haversineDistance(
      prev.latitude,
      prev.longitude,
      curr.latitude,
      curr.longitude
    )
    if (curr.speed !== null) {
      maxSpeed = maxSpeed !== null ? Math.max(maxSpeed, curr.speed) : curr.speed
    }
  }

  const startTime = locations[0].createdAt
  const endTime = locations[locations.length - 1].createdAt
  const totalDurationSeconds =
    (endTime.getTime() - startTime.getTime()) / 1000

  const averageSpeedMps =
    totalDurationSeconds > 0 ? totalDistance / totalDurationSeconds : null

  return {
    missionId,
    agentId: locations[0].agentId,
    pointCount: locations.length,
    totalDistanceMeters: Math.round(totalDistance),
    totalDurationSeconds: Math.round(totalDurationSeconds),
    startTime,
    endTime,
    averageSpeedMps:
      averageSpeedMps !== null
        ? Math.round(averageSpeedMps * 100) / 100
        : null,
    maxSpeedMps:
      maxSpeed !== null ? Math.round(maxSpeed * 100) / 100 : null,
  }
}

// ─── Clean Old Locations ────────────────────────────────────────────────────

export async function cleanOldLocations(hours: number = DEFAULT_CLEANUP_HOURS) {
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() - hours)

  const result = await db.liveLocation.deleteMany({
    where: {
      createdAt: { lt: cutoff },
    },
  })

  return {
    deletedCount: result.count,
    cutoff,
    hours,
  }
}

// ─── Distance Helpers (re-exported for convenience) ────────────────────────

export { haversineDistance } from '@/lib/gps-geofence'

/** Format meters into a human-readable distance string */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`
  }
  return `${(meters / 1000).toFixed(2)}km`
}

/** Format seconds into a human-readable duration string */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}m ${secs}s`
  }
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}
