// ═══════════════════════════════════════════════════════════════════════════════
// Service Report — PDF Rendering
// ═══════════════════════════════════════════════════════════════════════════════
// Renders a ServiceReportRecord to an actual PDF (pdfkit — pure JS, no headless
// browser dependency). Fills the gap the model has carried since it was first
// scaffolded: reportPdfUrl existed as a field but nothing ever wrote to it, only
// formatReportSummary()'s WhatsApp/SMS text formatter was implemented.
//
// pdfkit streams pages rather than returning a buffer directly, so this collects
// the stream's chunks and resolves once the document is finished.

import PDFDocument from 'pdfkit';
import type { ServiceReportRecord, ReportOutcome } from '@/lib/service-report';

const OUTCOME_LABEL: Record<ReportOutcome, string> = {
  COMPLETED: 'Completed',
  PARTIALLY_COMPLETED: 'Partially Completed',
  FAILED: 'Failed',
  BENEFICIARY_UNAVAILABLE: 'Beneficiary Unavailable',
};

const OUTCOME_COLOR: Record<ReportOutcome, string> = {
  COMPLETED: '#16a34a',
  PARTIALLY_COMPLETED: '#d97706',
  FAILED: '#dc2626',
  BENEFICIARY_UNAVAILABLE: '#6b7280',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

// pdfkit's standard Helvetica font only supports WinAnsi encoding (roughly
// Latin-1) — anything outside that range (emoji like the 🥇 trust badge,
// most non-Latin scripts) renders as garbled glyphs rather than throwing, so
// it fails silently without this. Stripping non-Latin1 characters loses the
// badge emoji itself but keeps the surrounding text ("GOLD") legible, which
// beats corrupting the page. A proper fix would embed a Unicode font, but
// that's real added weight (font file, subsetting) not justified yet by
// what's actually rendered here (short structured fields, not free-form
// customer text with names in other scripts — that would need it).
const PDF_SAFE_REPLACEMENTS: Record<string, string> = {
  '—': '-', // em dash
  '–': '-', // en dash
  '‘': "'", '’': "'", // curly single quotes
  '“': '"', '”': '"', // curly double quotes
  '…': '...', // ellipsis
};

function sanitizeForPdf(text: string): string {
  const withAsciiPunctuation = text.replace(
    /[—–‘’“”…]/g,
    (char) => PDF_SAFE_REPLACEMENTS[char] ?? char,
  );
  return withAsciiPunctuation.replace(/[^\x00-\xFF]/g, '').replace(/\s+/g, ' ').trim();
}

/** Renders a service report to PDF bytes. Never throws for missing/optional
 * fields — every section degrades to an em-dash rather than failing the whole
 * render, since a report with partial data (e.g. no GPS on a FAILED mission)
 * is exactly the kind of report this needs to still produce. */
export function renderServiceReportPdf(report: ServiceReportRecord): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Header ────────────────────────────────────────────────────────────
    doc
      .fontSize(18)
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .text('ASOJU FieldForce', { continued: false });
    doc
      .fontSize(11)
      .fillColor('#6b7280')
      .font('Helvetica')
      .text('Service Completion Report');
    doc.moveDown(1);

    doc
      .fontSize(14)
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .text(sanitizeForPdf(report.title));
    doc.moveDown(0.5);

    // ── Outcome badge ─────────────────────────────────────────────────────
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor(OUTCOME_COLOR[report.outcome])
      .text(`Status: ${OUTCOME_LABEL[report.outcome]}`);
    doc.fillColor('#111827').font('Helvetica');
    doc.moveDown(1);

    // ── Agent info ────────────────────────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold').text('Agent');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${sanitizeForPdf(report.agentName)}`);
    doc.text(`Phone: ${sanitizeForPdf(report.agentPhone)}`);
    if (report.agentTier) doc.text(`Tier: ${sanitizeForPdf(report.agentTier)}`);
    if (report.trustBadge) {
      const trustLine = sanitizeForPdf(`Trust: ${report.trustBadge} ${report.trustTier ?? ''}`.trim());
      if (trustLine) doc.text(trustLine);
    }
    doc.moveDown(1);

    // ── Summary narrative ─────────────────────────────────────────────────
    if (report.summary) {
      doc.fontSize(12).font('Helvetica-Bold').text('Summary');
      doc.fontSize(10).font('Helvetica').text(sanitizeForPdf(report.summary), { align: 'left' });
      doc.moveDown(1);
    }

    // ── Evidence & verification ──────────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold').text('Evidence & Verification');
    doc.fontSize(10).font('Helvetica');
    const photoCount = report.photoUrls ? (JSON.parse(report.photoUrls) as string[]).length : 0;
    doc.text(`Photos submitted: ${photoCount}`);
    doc.text(`Address verified on-site: ${report.addressVerified ? 'Yes' : 'No'}`);
    if (report.gpsLat !== null && report.gpsLng !== null) {
      const accuracy = report.gpsAccuracy !== null ? ` (±${Math.round(report.gpsAccuracy)}m)` : '';
      doc.text(`GPS: ${report.gpsLat.toFixed(6)}, ${report.gpsLng.toFixed(6)}${accuracy}`);
    } else {
      doc.text('GPS: not recorded');
    }
    doc.moveDown(1);

    // ── Timeline ──────────────────────────────────────────────────────────
    doc.fontSize(12).font('Helvetica-Bold').text('Timeline');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Accepted: ${formatDate(report.acceptedAt)}`);
    doc.text(`Arrived: ${formatDate(report.arrivedAt)}`);
    doc.text(`Completed: ${formatDate(report.completedAt)}`);
    doc.text(`Submitted: ${formatDate(report.submittedAt)}`);
    doc.text(`Duration: ${formatDuration(report.durationMinutes)}`);
    doc.moveDown(1.5);

    // ── Footer ────────────────────────────────────────────────────────────
    doc
      .fontSize(8)
      .fillColor('#9ca3af')
      .text(
        `Generated ${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })} · Report ID ${report.id}`,
        { align: 'center' },
      );

    doc.end();
  });
}
