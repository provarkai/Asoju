import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { CaseStatus, IncidentSeverity, QcOutcome } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CasesService } from '../cases/cases.service';
import { RiskEngineService } from '../risk/risk-engine.service';
import { StorageService } from '../storage/storage.service';
import { AgentTieringService } from '../agent-tiering/agent-tiering.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateEvidenceDto } from './dto/create-evidence.dto';
import { PerformQcDto } from './dto/perform-qc.dto';
import { RequestUploadUrlDto } from '../storage/dto/request-upload-url.dto';

const EVIDENCE_KEY_PREFIX = 'evidence';

const INCIDENT_SEVERITY_BY_OUTCOME: Partial<Record<QcOutcome, IncidentSeverity>> = {
  [QcOutcome.ESCALATE]: IncidentSeverity.HIGH,
  [QcOutcome.INCIDENT]: IncidentSeverity.CRITICAL,
};

@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly casesService: CasesService,
    private readonly riskEngine: RiskEngineService,
    private readonly storage: StorageService,
    private readonly agentTiering: AgentTieringService,
  ) {}

  /** Step one of a real upload: mints a case-scoped key and a short-lived
   * presigned PUT URL. The client uploads bytes straight to storage with
   * this, then submits the returned storageKey via submitEvidence() —
   * which verifies it before trusting it (see below). */
  async createUploadUrl(caseId: string, dto: RequestUploadUrlDto) {
    const key = this.storage.createKey(`${EVIDENCE_KEY_PREFIX}/${caseId}`, dto.fileName);
    const { url, expiresInSeconds } = await this.storage.getUploadUrl(key, dto.contentType);
    return { storageKey: key, uploadUrl: url, method: 'PUT', expiresInSeconds };
  }

  /**
   * Vertical slice 4: Assignment -> Field Execution. Field Agent App
   * "offline support" hardening — if the caller sends a clientRequestId
   * (the offline queue always does), a replay of the same submission
   * after a dropped response returns the row already created instead of
   * creating a duplicate.
   */
  async submitEvidence(actor: AuthenticatedUser, caseId: string, dto: CreateEvidenceDto) {
    if (dto.clientRequestId) {
      const existing = await this.prisma.evidence.findUnique({
        where: { caseId_clientRequestId: { caseId, clientRequestId: dto.clientRequestId } },
      });
      if (existing) return existing;
    }

    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (serviceCase.status !== CaseStatus.IN_PROGRESS) {
      throw new BadRequestException(`Cannot submit evidence for a case in status ${serviceCase.status}`);
    }

    // A storageKey can only ever have come from createUploadUrl() above —
    // never a client-invented value pointing at someone else's object, or
    // at nothing at all. The prefix proves it was issued for this case;
    // objectExists() (real once S3 is configured, a no-op in dry-run mode
    // same as every other integration here) proves the upload actually
    // landed before this evidence row gets created against it.
    if (!dto.storageKey.startsWith(`${EVIDENCE_KEY_PREFIX}/${caseId}/`)) {
      throw new BadRequestException('storageKey was not issued for this case — request a new upload URL');
    }
    if (!(await this.storage.objectExists(dto.storageKey))) {
      throw new BadRequestException('Uploaded file not found — the upload may not have completed. Request a new upload URL and try again.');
    }

    // Placeholder integrity hash pending byte-level checksumming from the
    // storage provider — this covers the metadata path, not byte-for-byte
    // content integrity.
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
        clientRequestId: dto.clientRequestId,
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

  /** Section 5.4 Field Agent App — "Execute checklist" step (Section 6.1).
   * Idempotent: a replayed completion of an already-complete task is a
   * no-op rather than re-timestamping it and re-logging the audit event —
   * the offline queue can replay this safely after a dropped response. */
  async completeTask(actor: AuthenticatedUser, caseId: string, taskId: string) {
    const task = await this.prisma.caseTask.findUnique({ where: { id: taskId } });
    if (!task || task.caseId !== caseId) throw new NotFoundException('Checklist item not found on this case');
    if (task.isComplete) return task;

    const updated = await this.prisma.caseTask.update({
      where: { id: taskId },
      data: { isComplete: true, completedAt: new Date() },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case_task.completed',
      metadata: { taskId, label: task.label },
    });

    return updated;
  }

  /**
   * Section 5.4 Field Agent App — "Escalate exceptions". Distinct from QC's
   * escalate outcome: this is the agent flagging something *during*
   * fieldwork, before QC ever sees the case. Never hides the issue
   * (Non-Negotiable #7) but never blocks the agent from continuing either —
   * staff triage the flag separately.
   */
  async raiseException(actor: AuthenticatedUser, caseId: string, label: string, detail?: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const flag = await this.prisma.caseRiskFlag.create({
      data: { caseId, label, detail, raisedById: actor.id },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.exception_raised',
      metadata: { label, detail },
    });

    await this.riskEngine.assessCase(caseId);

    return flag;
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
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: { customer: true },
    });
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

    // Platform Expansion PRD §5.1 — logged unconditionally (every outcome,
    // not just the ones that produce a Report) so AgentTieringService has
    // a real QC-pass-rate signal, then recomputed immediately for whoever
    // worked the case rather than waiting on the nightly cron sweep.
    await this.prisma.qcReview.create({
      data: { caseId, outcome: dto.outcome, reviewedById: actor.id },
    });
    await this.agentTiering.recomputeAgentsForCase(caseId);

    if (dto.outcome === QcOutcome.APPROVED || dto.outcome === QcOutcome.PASS_WITH_LIMITATION) {
      if (!dto.summary) throw new BadRequestException('summary is required to approve and issue a report');
      if (dto.outcome === QcOutcome.PASS_WITH_LIMITATION && !dto.note?.trim()) {
        throw new BadRequestException('note is required as the recorded limitation for PASS_WITH_LIMITATION');
      }

      const report = await this.prisma.report.create({
        data: {
          caseId,
          summary: dto.summary,
          findings: (dto.findings ?? {}) as any,
          qcOutcome: dto.outcome,
          limitation: dto.outcome === QcOutcome.PASS_WITH_LIMITATION ? dto.note : undefined,
          qcReviewedById: actor.id,
          qcReviewedAt: new Date(),
        },
      });

      await this.casesService.transitionCase(actor, caseId, CaseStatus.CUSTOMER_REVIEW, 'QC approved — report issued');
      await this.notifications.notify(
        serviceCase.customer.userId,
        'Your report is ready',
        dto.outcome === QcOutcome.PASS_WITH_LIMITATION
          ? `The report for ${serviceCase.caseNumber} is ready for your review — it includes a noted limitation, see the report for details.`
          : `The report for ${serviceCase.caseNumber} is ready for your review — approve it or let us know if something needs another look.`,
      );
      return { outcome: dto.outcome, report };
    }

    if (dto.outcome === QcOutcome.REWORK) {
      await this.casesService.transitionCase(actor, caseId, CaseStatus.IN_PROGRESS, dto.note ?? 'QC requested rework');
      await this.riskEngine.assessCase(caseId);
      return { outcome: dto.outcome };
    }

    if (dto.outcome === QcOutcome.REVISIT_REQUIRED) {
      if (!dto.note?.trim()) throw new BadRequestException('note is required describing what the revisit needs to cover');

      const maxSortOrder = await this.prisma.caseTask.aggregate({ where: { caseId }, _max: { sortOrder: true } });
      const task = await this.prisma.caseTask.create({
        data: {
          caseId,
          label: `Revisit required: ${dto.note}`,
          isRequired: true,
          sortOrder: (maxSortOrder._max.sortOrder ?? 0) + 1,
        },
      });

      await this.casesService.transitionCase(actor, caseId, CaseStatus.IN_PROGRESS, `QC requires a revisit — ${dto.note}`);
      await this.notifications.notify(
        serviceCase.customer.userId,
        'A follow-up site visit is needed',
        `Quality control found that ${serviceCase.caseNumber} needs another site visit before we can finish — we've scheduled the follow-up and will keep you posted.`,
      );
      await this.riskEngine.assessCase(caseId);
      return { outcome: dto.outcome, task };
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

    await this.riskEngine.assessCase(caseId);

    return { outcome: dto.outcome, incident };
  }
}
