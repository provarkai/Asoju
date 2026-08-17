import PDFDocument from 'pdfkit';

// ═══════════════════════════════════════════════════════════════════════════════
// Case Completion Report — PDF Rendering
// ═══════════════════════════════════════════════════════════════════════════════
// Ported from FieldForce's service-report-pdf.ts (pdfkit — pure JS, no
// headless-browser dependency). Same real gap it filled there: ASOJU's
// `Report` model has carried a completion summary/findings/qcOutcome
// since QC shipped, with nothing ever rendering it to an actual document
// customers or staff can download — CaseReportPdfService is the only
// caller of this file.

export interface CaseReportPdfInput {
  reportId: string;
  caseNumber: string;
  serviceType: string;
  description: string;
  location: string;
  summary: string;
  qcOutcome: string | null;
  limitation: string | null;
  deliveredAt: Date | null;
  createdAt: Date;

  agentName: string | null;
  agentPhone: string | null;
  trustTier: string | null;
  trustBadge: string | null;

  evidenceCount: number;
  evidencePhotoCount: number;

  checkInAt: Date | null;
  checkInGps: { lat: number; lng: number } | null;
  checkInAccuracy: number | null;
  geofenceResult: string | null;
  completedAt: Date | null;
}

const QC_OUTCOME_LABEL: Record<string, string> = {
  APPROVED: 'Approved',
  PASS_WITH_LIMITATION: 'Approved (with recorded limitation)',
  REWORK: 'Sent back for rework',
  ESCALATE: 'Escalated',
  INCIDENT: 'Incident raised',
  REVISIT_REQUIRED: 'Revisit required',
};

const QC_OUTCOME_COLOR: Record<string, string> = {
  APPROVED: '#16a34a',
  PASS_WITH_LIMITATION: '#d97706',
  REWORK: '#dc2626',
  ESCALATE: '#dc2626',
  INCIDENT: '#dc2626',
  REVISIT_REQUIRED: '#d97706',
};

function formatDate(date: Date | null): string {
  if (!date) return '-';
  return date.toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });
}

// pdfkit's standard Helvetica font only supports WinAnsi encoding
// (roughly Latin-1) — anything outside that range (emoji like a trust
// badge, most non-Latin scripts) renders as garbled glyphs rather than
// throwing, so it fails silently without this. Same fix already proven
// in FieldForce's service-report-pdf.ts: strip non-Latin1 characters
// (losing the badge emoji itself but keeping "GOLD" etc. legible) rather
// than corrupting the page. A proper fix would embed a Unicode font —
// real added weight not justified yet by what's actually rendered here
// (short structured fields, not free-form text in other scripts).
const PDF_SAFE_REPLACEMENTS: Record<string, string> = {
  '—': '-',
  '–': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
};

function sanitizeForPdf(text: string): string {
  const withAsciiPunctuation = text.replace(/[—–‘’“”…]/g, (char) => PDF_SAFE_REPLACEMENTS[char] ?? char);
  return withAsciiPunctuation.replace(/[^\x00-\xFF]/g, '').replace(/\s+/g, ' ').trim();
}

/** Renders a case's completion report to PDF bytes. Never throws for
 * missing/optional fields — every section degrades to a dash rather than
 * failing the whole render, since a report with partial data (no GPS on
 * a case whose property has no coordinates on file, no agent on a
 * provider-only assignment) is exactly the kind of report this needs to
 * still produce. */
export function renderCaseReportPdf(input: CaseReportPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Header ────────────────────────────────────────────────────────────
    doc.fontSize(18).fillColor('#111827').font('Helvetica-Bold').text('ASOJU');
    doc.fontSize(11).fillColor('#6b7280').font('Helvetica').text('Case Completion Report');
    doc.moveDown(1);

    doc
      .fontSize(14)
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .text(`${sanitizeForPdf(input.caseNumber)} — ${sanitizeForPdf(input.serviceType)}`);
    doc.fontSize(10).font('Helvetica').fillColor('#374151').text(sanitizeForPdf(input.description));
    doc.text(`Location: ${sanitizeForPdf(input.location)}`);
    doc.moveDown(0.5);

    // ── QC outcome badge ─────────────────────────────────────────────────
    const outcomeLabel = input.qcOutcome ? (QC_OUTCOME_LABEL[input.qcOutcome] ?? input.qcOutcome) : 'Pending';
    const outcomeColor = input.qcOutcome ? (QC_OUTCOME_COLOR[input.qcOutcome] ?? '#111827') : '#6b7280';
    doc.fontSize(11).font('Helvetica-Bold').fillColor(outcomeColor).text(`QC Outcome: ${outcomeLabel}`);
    doc.fillColor('#111827').font('Helvetica');
    if (input.limitation) {
      doc.fontSize(10).fillColor('#d97706').text(`Recorded limitation: ${sanitizeForPdf(input.limitation)}`);
      doc.fillColor('#111827');
    }
    doc.moveDown(1);

    // ── Field agent ───────────────────────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold').text('Field Agent');
    doc.fontSize(10).font('Helvetica');
    if (input.agentName) {
      doc.text(`Name: ${sanitizeForPdf(input.agentName)}`);
      if (input.agentPhone) doc.text(`Phone: ${sanitizeForPdf(input.agentPhone)}`);
      if (input.trustBadge || input.trustTier) {
        const trustLine = sanitizeForPdf(`Trust: ${input.trustBadge ?? ''} ${input.trustTier ?? ''}`.trim());
        if (trustLine) doc.text(trustLine);
      }
    } else {
      doc.text('No field agent assignment on record');
    }
    doc.moveDown(1);

    // ── Summary ───────────────────────────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold').text('Summary');
    doc.fontSize(10).font('Helvetica').text(sanitizeForPdf(input.summary));
    doc.moveDown(1);

    // ── Evidence & verification ─────────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold').text('Evidence & Verification');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Evidence items submitted: ${input.evidenceCount} (${input.evidencePhotoCount} photo${input.evidencePhotoCount === 1 ? '' : 's'})`);
    if (input.checkInGps) {
      const accuracy = input.checkInAccuracy !== null ? ` (+/-${Math.round(input.checkInAccuracy)}m)` : '';
      doc.text(`Check-in GPS: ${input.checkInGps.lat.toFixed(6)}, ${input.checkInGps.lng.toFixed(6)}${accuracy}`);
    } else {
      doc.text('Check-in GPS: not recorded');
    }
    if (input.geofenceResult) doc.text(`Geofence result: ${sanitizeForPdf(input.geofenceResult)}`);
    doc.moveDown(1);

    // ── Timeline ──────────────────────────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold').text('Timeline');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Case opened: ${formatDate(input.createdAt)}`);
    doc.text(`Field check-in: ${formatDate(input.checkInAt)}`);
    doc.text(`Assignment completed: ${formatDate(input.completedAt)}`);
    doc.text(`Report delivered: ${formatDate(input.deliveredAt)}`);
    doc.moveDown(1.5);

    // ── Footer ────────────────────────────────────────────────────────────
    doc
      .fontSize(8)
      .fillColor('#9ca3af')
      .text(`Generated ${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })} - Report ID ${input.reportId}`, {
        align: 'center',
      });

    doc.end();
  });
}
