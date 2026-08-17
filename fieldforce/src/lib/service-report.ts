// ═══════════════════════════════════════════════════════════════════════════════
// ASOJU FieldForce — Service Complete Report Generator
// Creates comprehensive service reports when missions complete.
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { renderServiceReportPdf } from '@/lib/service-report-pdf';
import { saveServiceReportPdf } from '@/lib/service-report-storage';

// ─── Report Outcome Types ──────────────────────────────────────────────────

export type ReportOutcome =
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'BENEFICIARY_UNAVAILABLE';

export type DeliveryChannel = 'WHATSAPP' | 'SMS' | 'EMAIL' | 'IN_APP';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';

// ─── Service Report Record ─────────────────────────────────────────────────

export interface ServiceReportRecord {
  id: string;
  missionId: string;
  caseId: string;
  customerId: string;
  agentId: string;
  title: string;
  summary: string | null;
  outcome: ReportOutcome;
  photoUrls: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracy: number | null;
  addressVerified: boolean;
  acceptedAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  submittedAt: string | null;
  durationMinutes: number | null;
  agentName: string;
  agentPhone: string;
  agentTier: string | null;
  trustTier: string | null;
  trustBadge: string | null;
  reportPdfUrl: string | null;
  deliveredAt: string | null;
  deliveryChannel: string | null;
  deliveryStatus: string;
  deliveryId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Report Evidence Item (simplified for report) ───────────────────────────

interface ReportEvidence {
  id: string;
  mimeType: string | null;
  size: number | null;
  capturedAt: string | null;
  status: string;
  storageKey: string | null;
}

// ─── Report GPS Check (simplified for report) ──────────────────────────────

interface ReportGpsCheck {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  distanceFromTarget: number | null;
  result: string;
  capturedAt: string;
}

// ─── Generate Service Report ───────────────────────────────────────────────
// Loads mission, case, agent, evidence, GPS checks, builds report,
// auto-generates summary text, determines outcome, saves to ServiceReport.

export async function generateServiceReport(
  missionId: string,
): Promise<ServiceReportRecord> {
  // ── Load mission with related data ────────────────────────────────────────
  const mission = await db.mission.findUniqueOrThrow({
    where: { id: missionId },
    include: {
      agent: {
        select: {
          id: true,
          displayName: true,
          phone: true,
          tier: { select: { name: true } },
          trustScore: { select: { trustTier: true, trustBadge: true } },
        },
      },
    },
  });

  // ── Load case ─────────────────────────────────────────────────────────────
  const case_ = await db.case.findUniqueOrThrow({
    where: { id: mission.caseId },
    select: {
      id: true,
      caseNumber: true,
      customerId: true,
      title: true,
      description: true,
      status: true,
    },
  });

  // ── Load evidence ─────────────────────────────────────────────────────────
  const evidence = await db.evidenceItem.findMany({
    where: { missionId },
    select: {
      id: true,
      mimeType: true,
      size: true,
      capturedAt: true,
      status: true,
      storageKey: true,
    },
    orderBy: { capturedAt: 'asc' },
  });

  // ── Load GPS checks ───────────────────────────────────────────────────────
  const gpsChecks = await db.gpsCheck.findMany({
    where: { missionId },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      accuracy: true,
      distanceFromTarget: true,
      result: true,
      capturedAt: true,
    },
    orderBy: { capturedAt: 'asc' },
  });

  // ── Determine outcome ─────────────────────────────────────────────────────
  const outcome = determineOutcome(mission.workflowState, evidence, gpsChecks);

  // ── Gather GPS data for report ────────────────────────────────────────────
  const bestGpsCheck = gpsChecks.find(g => g.result === 'PASS') ?? gpsChecks[0] ?? null;
  const gpsLat = bestGpsCheck?.latitude ?? null;
  const gpsLng = bestGpsCheck?.longitude ?? null;
  const gpsAccuracy = bestGpsCheck?.accuracy ?? null;
  const addressVerified = gpsChecks.some(g => g.result === 'PASS');

  // ── Photo URLs ────────────────────────────────────────────────────────────
  const photoEvidence = evidence.filter(e =>
    e.mimeType?.startsWith('image/') && e.status !== 'QUARANTINED' && e.status !== 'REJECTED'
  );
  const photoUrls = photoEvidence.length > 0
    ? JSON.stringify(photoEvidence.map(e => e.storageKey ?? e.id))
    : null;

  // ── Duration calculation ──────────────────────────────────────────────────
  let durationMinutes: number | null = null;
  if (mission.acceptedAt && mission.completedAt) {
    const ms = new Date(mission.completedAt).getTime() - new Date(mission.acceptedAt).getTime();
    durationMinutes = Math.round(ms / (1000 * 60));
  }

  // ── Auto-generate summary ─────────────────────────────────────────────────
  const summary = generateSummaryText({
    missionTitle: mission.title,
    serviceCode: mission.serviceCode,
    agentName: mission.agent.displayName,
    workflowState: mission.workflowState as string,
    outcome,
    evidenceCount: evidence.length,
    photoCount: photoEvidence.length,
    gpsPassCount: gpsChecks.filter(g => g.result === 'PASS').length,
    gpsTotalCount: gpsChecks.length,
    durationMinutes,
    addressVerified,
    beneficiaryName: mission.beneficiaryName,
    address: mission.address,
    completedAt: mission.completedAt,
  });

  // ── Build agent info snapshot ─────────────────────────────────────────────
  const agentName = mission.agent.displayName;
  const agentPhone = mission.agent.phone;
  const agentTier = mission.agent.tier?.name ?? null;
  const trustTier = mission.agent.trustScore?.trustTier ?? null;
  const trustBadge = mission.agent.trustScore?.trustBadge ?? null;

  // ── Report title ──────────────────────────────────────────────────────────
  const title = `Service Report — ${case_.title}`;

  // ── Upsert service report (missionId is @unique) ─────────────────────────
  const report = await db.serviceReport.upsert({
    where: { missionId },
    create: {
      missionId,
      caseId: case_.id,
      customerId: case_.customerId,
      agentId: mission.agentId,
      title,
      summary,
      outcome,
      photoUrls,
      gpsLat,
      gpsLng,
      gpsAccuracy,
      addressVerified,
      acceptedAt: mission.acceptedAt,
      arrivedAt: null, // Could be derived from GPS check-in time
      completedAt: mission.completedAt,
      submittedAt: mission.submittedAt,
      durationMinutes,
      agentName,
      agentPhone,
      agentTier,
      trustTier,
      trustBadge,
    },
    update: {
      title,
      summary,
      outcome,
      photoUrls,
      gpsLat,
      gpsLng,
      gpsAccuracy,
      addressVerified,
      acceptedAt: mission.acceptedAt,
      completedAt: mission.completedAt,
      submittedAt: mission.submittedAt,
      durationMinutes,
      agentName,
      agentPhone,
      agentTier,
      trustTier,
      trustBadge,
    },
  });

  // ── Render + persist PDF ──────────────────────────────────────────────────
  // Runs after the upsert since the PDF footer/URL both need the report's id.
  // Never lets a render failure fail report generation itself — the report
  // record (and its text summary, already usable for WhatsApp/SMS delivery)
  // is the primary artifact; the PDF is an enhancement on top of it.
  let reportPdfUrl: string | null = report.reportPdfUrl;
  try {
    const pdfBytes = await renderServiceReportPdf(report as unknown as ServiceReportRecord);
    reportPdfUrl = await saveServiceReportPdf(case_.id, report.id, pdfBytes);
    await db.serviceReport.update({
      where: { id: report.id },
      data: { reportPdfUrl },
    });
  } catch (error) {
    console.error('[SERVICE REPORT] PDF render/save failed', error);
  }

  return { ...report, reportPdfUrl } as unknown as ServiceReportRecord;
}

// ─── Deliver Service Report ───────────────────────────────────────────────
// Marks the report as delivered via the specified channel.

export async function deliverServiceReport(
  reportId: string,
  channel: DeliveryChannel,
): Promise<ServiceReportRecord> {
  const report = await db.serviceReport.update({
    where: { id: reportId },
    data: {
      deliveryChannel: channel,
      deliveryStatus: 'SENT',
      deliveredAt: new Date(),
    },
  });

  return report as unknown as ServiceReportRecord;
}

// ─── Get Report for Case ───────────────────────────────────────────────────

export async function getReportForCase(
  caseId: string,
): Promise<ServiceReportRecord | null> {
  // Find the mission for this case, then the report
  const mission = await db.mission.findUnique({
    where: { caseId },
    select: { id: true },
  });

  if (!mission) return null;

  const report = await db.serviceReport.findUnique({
    where: { missionId: mission.id },
  });

  return report as unknown as ServiceReportRecord | null;
}

// ─── Determine Outcome ────────────────────────────────────────────────────

function determineOutcome(
  workflowState: string,
  evidence: ReportEvidence[],
  gpsChecks: ReportGpsCheck[],
): ReportOutcome {
  if (workflowState === 'COMPLETED') {
    // Check for partial completion indicators
    const hasEvidence = evidence.length > 0;
    const hasGpsPass = gpsChecks.some(g => g.result === 'PASS');

    if (hasEvidence && hasGpsPass) {
      return 'COMPLETED';
    }
    if (hasEvidence || hasGpsPass) {
      return 'PARTIALLY_COMPLETED';
    }
    return 'COMPLETED'; // Agent marked complete, trust the workflow
  }

  if (workflowState === 'FAILED') {
    return 'FAILED';
  }

  return 'PARTIALLY_COMPLETED';
}

// ─── Generate Summary Text ─────────────────────────────────────────────────

interface SummaryInput {
  missionTitle: string;
  serviceCode: string;
  agentName: string;
  workflowState: string;
  outcome: ReportOutcome;
  evidenceCount: number;
  photoCount: number;
  gpsPassCount: number;
  gpsTotalCount: number;
  durationMinutes: number | null;
  addressVerified: boolean;
  beneficiaryName: string | null;
  address: string | null;
  completedAt: string | null;
}

function generateSummaryText(input: SummaryInput): string {
  const parts: string[] = [];

  // Opening line
  if (input.outcome === 'COMPLETED') {
    parts.push(
      `Service "${input.missionTitle}" was successfully completed by ${input.agentName}.`
    );
  } else if (input.outcome === 'PARTIALLY_COMPLETED') {
    parts.push(
      `Service "${input.missionTitle}" was partially completed by ${input.agentName}.`
    );
  } else if (input.outcome === 'FAILED') {
    parts.push(
      `Service "${input.missionTitle}" could not be completed.`
    );
  } else {
    parts.push(
      `Service "${input.missionTitle}" was attempted but the beneficiary was unavailable.`
    );
  }

  // Beneficiary & location
  if (input.beneficiaryName) {
    parts.push(`Beneficiary: ${input.beneficiaryName}.`);
  }
  if (input.address) {
    parts.push(`Location: ${input.address}.`);
  }

  // Evidence summary
  if (input.evidenceCount > 0) {
    parts.push(
      `${input.evidenceCount} evidence item${input.evidenceCount > 1 ? 's' : ''} submitted` +
      (input.photoCount > 0 ? ` (${input.photoCount} photo${input.photoCount > 1 ? 's' : ''}).` : '.')
    );
  } else {
    parts.push('No evidence was submitted.');
  }

  // GPS verification
  if (input.gpsTotalCount > 0) {
    parts.push(
      `GPS verification: ${input.gpsPassCount}/${input.gpsTotalCount} checks passed.` +
      (input.addressVerified ? ' Address verified on-site.' : '')
    );
  }

  // Duration
  if (input.durationMinutes !== null) {
    const hours = Math.floor(input.durationMinutes / 60);
    const mins = input.durationMinutes % 60;
    if (hours > 0) {
      parts.push(`Total duration: ${hours}h ${mins}m.`);
    } else {
      parts.push(`Total duration: ${mins} minutes.`);
    }
  }

  // Completion timestamp
  if (input.completedAt) {
    const dateStr = new Date(input.completedAt).toLocaleString('en-NG', {
      timeZone: 'Africa/Lagos',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    parts.push(`Completed at ${dateStr}.`);
  }

  return parts.join(' ');
}

// ─── Format Report Summary for WhatsApp/SMS ───────────────────────────────
// Generates a concise, human-readable summary for messaging channels.

export function formatReportSummary(report: ServiceReportRecord): string {
  const lines: string[] = [];

  lines.push(`📋 *${report.title}*`);
  lines.push('');

  // Outcome badge
  const outcomeEmoji: Record<ReportOutcome, string> = {
    COMPLETED: '✅',
    PARTIALLY_COMPLETED: '⚠️',
    FAILED: '❌',
    BENEFICIARY_UNAVAILABLE: '🚫',
  };
  const outcomeLabel: Record<ReportOutcome, string> = {
    COMPLETED: 'Completed',
    PARTIALLY_COMPLETED: 'Partially Completed',
    FAILED: 'Failed',
    BENEFICIARY_UNAVAILABLE: 'Beneficiary Unavailable',
  };

  lines.push(`${outcomeEmoji[report.outcome]} Status: *${outcomeLabel[report.outcome]}*`);
  lines.push('');

  // Agent info
  lines.push(`👤 Agent: ${report.agentName}`);
  if (report.trustBadge) {
    lines.push(`   Trust: ${report.trustBadge} ${report.trustTier ?? ''}`);
  }
  lines.push('');

  // Summary narrative
  if (report.summary) {
    lines.push(report.summary);
    lines.push('');
  }

  // Evidence
  const photoCount = report.photoUrls
    ? (JSON.parse(report.photoUrls) as string[]).length
    : 0;
  if (photoCount > 0) {
    lines.push(`📷 ${photoCount} photo${photoCount > 1 ? 's' : ''} attached`);
  }

  // GPS
  if (report.addressVerified) {
    lines.push('📍 Location verified on-site');
  } else if (report.gpsLat !== null && report.gpsLng !== null) {
    lines.push('📍 GPS location recorded');
  }

  // Duration
  if (report.durationMinutes !== null) {
    const hours = Math.floor(report.durationMinutes / 60);
    const mins = report.durationMinutes % 60;
    const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    lines.push(`⏱ Duration: ${durationStr}`);
  }

  // Completion time
  if (report.completedAt) {
    const dateStr = new Date(report.completedAt).toLocaleString('en-NG', {
      timeZone: 'Africa/Lagos',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    lines.push(`📅 ${dateStr}`);
  }

  lines.push('');
  lines.push('— ASOJU FieldForce');

  return lines.join('\n');
}
