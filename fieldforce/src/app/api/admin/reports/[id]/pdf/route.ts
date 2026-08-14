// ═══════════════════════════════════════════════════════════════════════════════
// Admin Service Report — PDF Download
// GET /api/admin/reports/[id]/pdf
// ═══════════════════════════════════════════════════════════════════════════════
// Streams a previously generated report PDF back out. reportPdfUrl on the
// ServiceReport record always points here rather than a raw filesystem path,
// so this route is the one place that needs to change when local disk storage
// is swapped for real object storage (S3/GCS).

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { db } from '@/lib/db';
import { readServiceReportPdf } from '@/lib/service-report-storage';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);

    const { id } = await params;
    const report = await db.serviceReport.findUnique({
      where: { id },
      select: { id: true, caseId: true, title: true, reportPdfUrl: true },
    });

    if (!report || !report.reportPdfUrl) {
      return NextResponse.json({ error: 'Report PDF not found' }, { status: 404 });
    }

    const pdfBytes = await readServiceReportPdf(report.caseId, report.id);
    if (!pdfBytes) {
      return NextResponse.json({ error: 'Report PDF not found' }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${report.title.replace(/[^a-z0-9-_ ]/gi, '')}.pdf"`,
        'Content-Length': String(pdfBytes.length),
      },
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const err = error as { status: number; message: string };
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ADMIN REPORTS PDF] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
