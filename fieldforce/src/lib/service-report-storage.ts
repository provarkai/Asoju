// ═══════════════════════════════════════════════════════════════════════════════
// Service Report — PDF Storage
// ═══════════════════════════════════════════════════════════════════════════════
// Unlike evidence-custody.ts's storage key generation (which never writes bytes,
// since photo/video capture and upload live client-side and aren't part of this
// codebase yet), the PDF here is actually generated in-process by
// service-report-pdf.ts — so there is something real to persist. Writes to local
// disk under storage/service-reports/ (gitignored, dev-only), same "LOCAL
// provider, will be S3/GCS in production" honesty as the rest of this codebase's
// storage layer. reportPdfUrl is set to an API route that streams the file back
// out (src/app/api/admin/reports/[id]/pdf/route.ts) rather than a raw filesystem
// path, so swapping in real object storage later only means changing what that
// route proxies to.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const STORAGE_ROOT = join(process.cwd(), 'storage', 'service-reports');

function pdfPath(caseId: string, reportId: string): string {
  return join(STORAGE_ROOT, caseId, `${reportId}.pdf`);
}

/** Persists the rendered PDF to local disk and returns the URL the report's
 * reportPdfUrl field should store (a route this app serves, not a raw path). */
export async function saveServiceReportPdf(
  caseId: string,
  reportId: string,
  pdfBytes: Buffer,
): Promise<string> {
  const path = pdfPath(caseId, reportId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, pdfBytes);
  return `/api/admin/reports/${reportId}/pdf`;
}

/** Reads a previously-saved report PDF back off disk. Returns null if it was
 * never generated (older reports predating this feature) rather than throwing,
 * so the serving route can degrade to a clean 404. */
export async function readServiceReportPdf(caseId: string, reportId: string): Promise<Buffer | null> {
  try {
    return await readFile(pdfPath(caseId, reportId));
  } catch {
    return null;
  }
}
