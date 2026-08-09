import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { CaseStatus, IncidentSeverity, QcOutcome } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CasesService } from '../cases/cases.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateEvidenceDto } from './dto/create-evidence.dto';
import { PerformQcDto } from './dto/perform-qc.dto';

const INCIDENT_SEVERITY_BY_OUTCOME: Partial<Record<QcOutcome, IncidentSeverity>> = {
  [QcOutcome.ESCALATE]: IncidentSeverity.HIGH,
  [QcOutcome.INCIDENT]: IncidentSeverity.CRITICAL,
};

@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly casesService: CasesService,
  ) {}

  /** Vertical slice 4: Assignment -> Field Execution. */
  async submitEvidence(actor: AuthenticatedUser, caseId: string, dto: CreateEvidenceDto) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (serviceCase.status !== CaseStatus.IN_PROGRESS) {
      throw new BadRequestException(`Cannot submit evidence for a case in status ${serviceCase.status}`);
    }

    // Placeholder integrity hash pending real file-upload integration
    // (Section 11.2: object storage is bought/integrated, not built here) —
    // this covers the metadata path, not byte-for-byte content integrity.
    const integrityHash = createHash('sha256')
      .update(`${dto.storageKey}:${actor.id}:${Date.now()}`)
      .digest('hex');

    const evidence = await this.prisma.evidence.create({
      data: {
        caseId,
        taskId: dto.taskId,
        uploaderId: actor.id,
        type: dto.type,
        evidenceLevel: dto.evidenceLevel ?? 'OBSERVED',
        description: dto.description,
        locationMetadata: dto.locationMetadata as any,
        storageKey: dto.storageKey,
        integrityHash,
        capturedAt: new Date(),
      },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'evidence.submitted',
      metadata: { evidenceId: evidence.id, type: dto.type },
    });

    return evidence;
  }

  /** Vertical slice 5: Field Execution -> Evidence complete. */
  async completeFieldwork(actor: AuthenticatedUser, caseId: string) {
    const evidenceCount = await this.prisma.evidence.count({ where: { caseId } });
    if (evidenceCount === 0) {
      throw new BadRequestException('Cannot submit a case with no evidence captured');
    }

    const updated = await this.casesService.transitionCase(
      actor,
      caseId,
      CaseStatus.EVIDENCE_SUBMITTED,
      'Field agent submitted evidence',
    );

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.fieldwork_completed',
      metadata: { evidenceCount },
    });

    return updated;
  }

  /**
   * Vertical slice 6: Evidence -> QC -> Report. "A field submission is
   * never automatically a completed case" (Section 8.5).
   */
  async performQc(actor: AuthenticatedUser, caseId: string, dto: PerformQcDto) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');
    const qcEligibleStatuses: CaseStatus[] = [CaseStatus.EVIDENCE_SUBMITTED, CaseStatus.QUALITY_CONTROL];
    if (!qcEligibleStatuses.includes(serviceCase.status)) {
      throw new BadRequestException(`Cannot perform QC on a case in status ${serviceCase.status}`);
    }

    if (serviceCase.status === CaseStatus.EVIDENCE_SUBMITTED) {
      await this.casesService.transitionCase(actor, caseId, CaseStatus.QUALITY_CONTROL, 'QC review started');
    }

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.qc_performed',
      metadata: { outcome: dto.outcome, note: dto.note },
    });

    if (dto.outcome === QcOutcome.APPROVED) {
      if (!dto.summary) throw new BadRequestException('summary is required to approve and issue a report');

      const report = await this.prisma.report.create({
        data: {
          caseId,
          summary: dto.summary,
          findings: (dto.findings ?? {}) as any,
          qcOutcome: QcOutcome.APPROVED,
          qcReviewedById: actor.id,
          qcReviewedAt: new Date(),
        },
      });

      await this.casesService.transitionCase(actor, caseId, CaseStatus.CUSTOMER_REVIEW, 'QC approved — report issued');
      return { outcome: dto.outcome, report };
    }

    if (dto.outcome === QcOutcome.REWORK) {
      await this.casesService.transitionCase(actor, caseId, CaseStatus.IN_PROGRESS, dto.note ?? 'QC requested rework');
      return { outcome: dto.outcome };
    }

    // ESCALATE / INCIDENT — Section 8.5: never hide the issue, but also
    // never silently push a flagged case forward. The case stays in
    // QUALITY_CONTROL pending a human decision; the flag/incident is what
    // makes that visible.
    await this.prisma.caseRiskFlag.create({
      data: { caseId, label: `QC outcome: ${dto.outcome}`, detail: dto.note, raisedById: actor.id },
    });
    const incident = await this.prisma.incident.create({
      data: {
        caseId,
        severity: INCIDENT_SEVERITY_BY_OUTCOME[dto.outcome] ?? IncidentSeverity.MEDIUM,
        summary: dto.summary ?? `QC ${dto.outcome.toLowerCase()} on case`,
        detail: dto.note,
      },
    });

    return { outcome: dto.outcome, incident };
  }
}
