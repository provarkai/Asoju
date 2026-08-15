// ═══════════════════════════════════════════════════════════════════════════════
// ASOJU FieldForce — Emergency SOS Protocol
// Handles emergency alerts from field agents with escalation chains
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';

// ─── SOS Alert Type Constants ─────────────────────────────────────────────

export const SOS_ALERT_TYPES = {
  GENERAL:   'GENERAL',
  MEDICAL:   'MEDICAL',
  SECURITY:  'SECURITY',
  SAFETY:    'SAFETY',
  LOST:      'LOST',
} as const;

export type SosAlertType = (typeof SOS_ALERT_TYPES)[keyof typeof SOS_ALERT_TYPES];

// ─── SOS Severity Levels ──────────────────────────────────────────────────

export const SOS_SEVERITY_LEVELS = {
  LOW:      'LOW',
  MEDIUM:   'MEDIUM',
  HIGH:     'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export type SosSeverity = (typeof SOS_SEVERITY_LEVELS)[keyof typeof SOS_SEVERITY_LEVELS];

// ─── SOS Status Lifecycle ─────────────────────────────────────────────────

export const SOS_STATUS = {
  ACTIVE:       'ACTIVE',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED:     'RESOLVED',
  ESCALATED:    'ESCALATED',
  FALSE_ALARM:  'FALSE_ALARM',
} as const;

export type SosStatus = (typeof SOS_STATUS)[keyof typeof SOS_STATUS];

// ─── Escalation Channels ──────────────────────────────────────────────────

export const ESCALATION_CHANNELS = [
  'admin',
  'whatsapp',
  'emergency_contact',
  'police',
] as const;

export type EscalationChannel = (typeof ESCALATION_CHANNELS)[number];

// ─── Sos Alert Record ─────────────────────────────────────────────────────

export interface SosAlertRecord {
  id: string;
  agentId: string;
  missionId: string | null;
  caseId: string | null;
  alertType: string;
  severity: string;
  message: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  address: string | null;
  status: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  escalationLevel: number;
  escalatedChannels: string | null;
  emergencyContacts: string | null;
  audioUrl: string | null;
  photoUrls: string | null;
  evidenceLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Trigger SOS Alert Input ───────────────────────────────────────────────

export interface TriggerSosInput {
  agentId: string;
  missionId?: string;
  caseId?: string;
  alertType: SosAlertType;
  severity: SosSeverity;
  message?: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  address?: string;
}

// ─── Max Escalation Level ──────────────────────────────────────────────────

const MAX_ESCALATION_LEVEL = ESCALATION_CHANNELS.length;

// ─── Trigger SOS Alert ────────────────────────────────────────────────────
// Creates a new SOS alert. Automatically locks related mission evidence.

export async function triggerSosAlert(
  input: TriggerSosInput,
): Promise<SosAlertRecord> {
  // Validate coordinates
  if (input.latitude < -90 || input.latitude > 90 ||
      input.longitude < -180 || input.longitude > 180) {
    throw new Error('Invalid GPS coordinates for SOS alert');
  }

  // Validate alert type
  const validTypes = new Set(Object.values(SOS_ALERT_TYPES));
  if (!validTypes.has(input.alertType)) {
    throw new Error(`Invalid alert type: ${input.alertType}`);
  }

  // Validate severity
  const validSeverities = new Set(Object.values(SOS_SEVERITY_LEVELS));
  if (!validSeverities.has(input.severity)) {
    throw new Error(`Invalid severity: ${input.severity}`);
  }

  // Determine if evidence should be locked (for active missions)
  const shouldLockEvidence = input.missionId != null;

  // Create the SOS alert
  const alert = await db.sosAlert.create({
    data: {
      agentId: input.agentId,
      missionId: input.missionId ?? null,
      caseId: input.caseId ?? null,
      alertType: input.alertType,
      severity: input.severity,
      message: input.message ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy ?? null,
      address: input.address ?? null,
      evidenceLocked: shouldLockEvidence,
    },
  });

  return alert as unknown as SosAlertRecord;
}

// ─── Acknowledge SOS Alert ────────────────────────────────────────────────
// An admin acknowledges the alert, indicating they are aware and responding.

export async function acknowledgeSosAlert(
  alertId: string,
  adminId: string,
): Promise<SosAlertRecord> {
  const alert = await db.sosAlert.findUniqueOrThrow({
    where: { id: alertId },
  });

  if (alert.status !== 'ACTIVE' && alert.status !== 'ESCALATED') {
    throw new Error(
      `Cannot acknowledge SOS alert in status: ${alert.status}. Only ACTIVE or ESCALATED alerts can be acknowledged.`
    );
  }

  const updated = await db.sosAlert.update({
    where: { id: alertId },
    data: {
      status: 'ACKNOWLEDGED',
      acknowledgedBy: adminId,
      acknowledgedAt: new Date(),
    },
  });

  return updated as unknown as SosAlertRecord;
}

// ─── Resolve SOS Alert ───────────────────────────────────────────────────
// An admin resolves the alert with resolution notes.

export async function resolveSosAlert(
  alertId: string,
  adminId: string,
  resolutionNotes: string,
): Promise<SosAlertRecord> {
  const alert = await db.sosAlert.findUniqueOrThrow({
    where: { id: alertId },
  });

  if (alert.status === 'RESOLVED' || alert.status === 'FALSE_ALARM') {
    throw new Error(
      `SOS alert is already in terminal status: ${alert.status}`
    );
  }

  const updated = await db.sosAlert.update({
    where: { id: alertId },
    data: {
      status: 'RESOLVED',
      resolvedBy: adminId,
      resolvedAt: new Date(),
      resolutionNotes,
    },
  });

  return updated as unknown as SosAlertRecord;
}

// ─── Escalate SOS Alert ──────────────────────────────────────────────────
// Escalates the alert to the next level in the escalation chain.
// Escalation chain: admin → whatsapp → emergency_contact → police

export async function escalateSosAlert(
  alertId: string,
  channel: EscalationChannel,
): Promise<SosAlertRecord> {
  const alert = await db.sosAlert.findUniqueOrThrow({
    where: { id: alertId },
  });

  // Only ACTIVE, ACKNOWLEDGED, or ESCALATED alerts can be escalated further
  if (alert.status !== 'ACTIVE' && alert.status !== 'ACKNOWLEDGED' && alert.status !== 'ESCALATED') {
    throw new Error(
      `Cannot escalate SOS alert in status: ${alert.status}`
    );
  }

  const nextLevel = alert.escalationLevel + 1;

  if (nextLevel > MAX_ESCALATION_LEVEL) {
    throw new Error('SOS alert has already been escalated to the maximum level');
  }

  // Build the updated escalation channels list
  const currentChannels: string[] = alert.escalatedChannels
    ? JSON.parse(alert.escalatedChannels)
    : [];

  if (!currentChannels.includes(channel)) {
    currentChannels.push(channel);
  }

  const updated = await db.sosAlert.update({
    where: { id: alertId },
    data: {
      status: 'ESCALATED',
      escalationLevel: nextLevel,
      escalatedChannels: JSON.stringify(currentChannels),
    },
  });

  return updated as unknown as SosAlertRecord;
}

// ─── Get Active Alerts ───────────────────────────────────────────────────
// Returns all currently active or escalated SOS alerts.

export async function getActiveAlerts(): Promise<SosAlertRecord[]> {
  const alerts = await db.sosAlert.findMany({
    where: {
      status: { in: ['ACTIVE', 'ACKNOWLEDGED', 'ESCALATED'] },
    },
    include: {
      agent: {
        select: {
          displayName: true,
          phone: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return alerts.map(a => ({
    ...a,
    agent: undefined, // Remove the nested agent from the flat record
  })) as unknown as SosAlertRecord[];
}

// ─── Get Alert History ───────────────────────────────────────────────────
// Returns historical alerts, optionally filtered by agent.

export async function getAlertHistory(
  agentId?: string,
  limit: number = 50,
): Promise<SosAlertRecord[]> {
  const where = agentId ? { agentId } : {};

  const alerts = await db.sosAlert.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return alerts as unknown as SosAlertRecord[];
}

// ─── Format SOS Alert Message for WhatsApp/SMS ───────────────────────────
// Generates an actionable, human-readable alert for instant delivery.

export function formatSosAlertMessage(
  alert: SosAlertRecord,
  agentName?: string,
): string {
  const lines: string[] = [];

  // Urgency header based on severity
  const severityHeader: Record<string, string> = {
    LOW:      '⚠️ ASOJU FieldForce — Alert',
    MEDIUM:   '🟠 ASOJU FieldForce — SOS Alert',
    HIGH:     '🔴 ASOJU FieldForce — URGENT SOS',
    CRITICAL: '🚨 ASOJU FieldForce — CRITICAL EMERGENCY',
  };

  lines.push(severityHeader[alert.severity] ?? '🚨 ASOJU FieldForce — SOS Alert');
  lines.push('');

  // Alert type
  const typeLabels: Record<string, string> = {
    GENERAL:  'General Emergency',
    MEDICAL:  'Medical Emergency',
    SECURITY: 'Security Threat',
    SAFETY:   'Safety Concern',
    LOST:     'Agent Lost / Disoriented',
  };

  lines.push(`*Type:* ${typeLabels[alert.alertType] ?? alert.alertType}`);
  lines.push(`*Severity:* ${alert.severity}`);
  lines.push(`*Status:* ${alert.status}`);
  lines.push('');

  // Agent info
  if (agentName) {
    lines.push(`*Agent:* ${agentName}`);
  }

  // Mission/case context
  if (alert.missionId) {
    lines.push(`*Mission:* ${alert.missionId}`);
  }
  if (alert.caseId) {
    lines.push(`*Case:* ${alert.caseId}`);
  }
  lines.push('');

  // Location
  lines.push(`*Location:* ${alert.latitude.toFixed(6)}, ${alert.longitude.toFixed(6)}`);
  if (alert.accuracy) {
    lines.push(`*Accuracy:* ±${Math.round(alert.accuracy)}m`);
  }
  if (alert.address) {
    lines.push(`*Address:* ${alert.address}`);
  }

  // Google Maps link
  lines.push(`*Map:* https://maps.google.com/?q=${alert.latitude},${alert.longitude}`);
  lines.push('');

  // Agent message
  if (alert.message) {
    lines.push(`*Message from agent:*`);
    lines.push(alert.message);
    lines.push('');
  }

  // Escalation info
  if (alert.escalationLevel > 0) {
    lines.push(`*Escalation Level:* ${alert.escalationLevel}/${MAX_ESCALATION_LEVEL}`);
    const channels: string[] = alert.escalatedChannels
      ? JSON.parse(alert.escalatedChannels)
      : [];
    if (channels.length > 0) {
      lines.push(`*Notified via:* ${channels.join(', ')}`);
    }
    lines.push('');
  }

  // Timestamp
  const timeStr = new Date(alert.createdAt).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  lines.push(`*Time:* ${timeStr}`);
  lines.push(`*Alert ID:* ${alert.id}`);
  lines.push('');
  lines.push('— ASOJU FieldForce Emergency System');

  return lines.join('\n');
}
