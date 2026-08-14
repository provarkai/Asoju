import { renderCaseReportPdf, CaseReportPdfInput } from './pdf-renderer';

function baseInput(overrides: Partial<CaseReportPdfInput> = {}): CaseReportPdfInput {
  return {
    reportId: 'report-1',
    caseNumber: 'ASJ-000123',
    serviceType: 'PROPERTY_INSPECTION',
    description: 'Inspect the property boundary and structure',
    location: 'Lekki, Lagos',
    summary: 'Inspection completed, property in good condition.',
    qcOutcome: 'APPROVED',
    limitation: null,
    deliveredAt: new Date('2026-08-01T10:00:00Z'),
    createdAt: new Date('2026-07-28T09:00:00Z'),
    agentName: 'Chidi Okafor',
    agentPhone: '+2348012345678',
    trustTier: 'GOLD',
    trustBadge: '🥇',
    evidenceCount: 3,
    evidencePhotoCount: 2,
    checkInAt: new Date('2026-07-30T11:00:00Z'),
    checkInGps: { lat: 6.5244, lng: 3.3792 },
    checkInAccuracy: 12,
    geofenceResult: 'PASS',
    completedAt: new Date('2026-07-30T12:30:00Z'),
    ...overrides,
  };
}

describe('renderCaseReportPdf', () => {
  it('renders valid PDF bytes with a %PDF header', async () => {
    const bytes = await renderCaseReportPdf(baseInput());
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('never throws on missing/optional fields — degrades to dashes instead', async () => {
    const bytes = await renderCaseReportPdf(
      baseInput({
        agentName: null,
        agentPhone: null,
        trustTier: null,
        trustBadge: null,
        checkInAt: null,
        checkInGps: null,
        checkInAccuracy: null,
        geofenceResult: null,
        completedAt: null,
        deliveredAt: null,
        qcOutcome: null,
        limitation: null,
      }),
    );
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders successfully with a trust badge emoji, the same bug class FieldForce hit', async () => {
    // pdfkit's Helvetica only supports WinAnsi (Latin-1) — a raw emoji in
    // the trust badge previously garbled the page; sanitizeForPdf strips
    // it internally. This just proves the render doesn't throw/corrupt.
    const bytes = await renderCaseReportPdf(baseInput({ trustBadge: '🥇', trustTier: 'GOLD' }));
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders a limitation line for PASS_WITH_LIMITATION without throwing', async () => {
    const bytes = await renderCaseReportPdf(
      baseInput({ qcOutcome: 'PASS_WITH_LIMITATION', limitation: 'Could not access the rear boundary — locked gate' }),
    );
    expect(bytes.length).toBeGreaterThan(0);
  });
});
