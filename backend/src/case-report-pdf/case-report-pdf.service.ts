import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { renderCaseReportPdf } from './pdf-renderer';

@Injectable()
export class CaseReportPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Renders (or returns the cached render of) this case's completion
   * report as a downloadable PDF. Authorization is CaseAccessGuard's job
   * at the route level — the same guard already proven on GET
   * cases/:caseId (customer who owns the case, the assigned field agent,
   * an explicit staff collaborator, or ADMIN/SUPER_ADMIN). Caches the
   * rendered PDF's storage key on the Report row so a repeatedly-viewed
   * report isn't re-rendered on every request. */
  async getReportPdfUrl(actor: AuthenticatedUser, caseId: string): Promise<{ downloadUrl: string }> {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: { reports: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const report = serviceCase.reports[0];
    if (!report) throw new NotFoundException('This case has no issued report yet');

    if (report.pdfStorageKey) {
      return { downloadUrl: await this.storage.getViewUrl(report.pdfStorageKey) };
    }

    const assignment = await this.prisma.assignment.findFirst({
      where: { caseId, role: 'FIELD_AGENT' },
      orderBy: { createdAt: 'desc' },
      include: { agent: { include: { trustScore: true, user: { select: { phone: true } } } } },
    });

    const evidence = await this.prisma.evidence.findMany({
      where: { caseId },
      select: { type: true },
    });

    const checkInGps = extractCheckInGps(assignment?.checkInLocation);

    const pdfBytes = await renderCaseReportPdf({
      reportId: report.id,
      caseNumber: serviceCase.caseNumber,
      serviceType: serviceCase.serviceType,
      description: serviceCase.description,
      location: serviceCase.location,
      summary: report.summary,
      qcOutcome: report.qcOutcome,
      limitation: report.limitation,
      deliveredAt: report.deliveredAt,
      createdAt: serviceCase.createdAt,

      agentName: assignment?.agent?.fullName ?? null,
      agentPhone: assignment?.agent?.user?.phone ?? null,
      trustTier: assignment?.agent?.trustScore?.trustTier ?? null,
      trustBadge: assignment?.agent?.trustScore?.trustBadge ?? null,

      evidenceCount: evidence.length,
      evidencePhotoCount: evidence.filter((e) => e.type === 'PHOTO').length,

      checkInAt: assignment?.checkInAt ?? null,
      checkInGps,
      checkInAccuracy: assignment?.checkInAccuracy ?? null,
      geofenceResult: assignment?.geofenceResult ?? null,
      completedAt: assignment?.completedAt ?? null,
    });

    const key = this.storage.createKey(`reports/${caseId}`, `${report.id}.pdf`);
    await this.storage.putBuffer(key, pdfBytes, 'application/pdf');
    await this.prisma.report.update({ where: { id: report.id }, data: { pdfStorageKey: key } });

    return { downloadUrl: await this.storage.getViewUrl(key) };
  }
}

/** Assignment.checkInLocation is a free-form Json field (a plain address
 * string is just as valid a check-in as structured coordinates — see
 * geofence.ts) — this extracts real lat/lng only when they're actually
 * present as numbers, never fabricating a fallback. */
function extractCheckInGps(checkInLocation: unknown): { lat: number; lng: number } | null {
  if (!checkInLocation || typeof checkInLocation !== 'object') return null;
  const loc = checkInLocation as Record<string, unknown>;
  if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
    return { lat: loc.lat, lng: loc.lng };
  }
  return null;
}
