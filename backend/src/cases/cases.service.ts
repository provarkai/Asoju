import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ApprovalAction,
  AssignmentRole,
  AssignmentStatus,
  AutomationDecisionOutcome,
  CasePriority,
  CaseStatus,
  CollaboratorRole,
  DisputeStatus,
  IdempotencyOperation,
  Role,
  ServiceType,
  VaultCategory,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { ConvertRequestDto } from './dto/convert-request.dto';
import { assertValidTransition } from './case-state-machine';
import { CHECKLIST_TEMPLATES } from './checklist-templates';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { filterDocumentsForFieldActor } from '../documents/document-visibility';
import { redactCustomerName } from '../common/pii-restricted-roles';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RaiseDisputeDto } from './dto/raise-dispute.dto';
import { BENEFICIARY_CASE_SELECT, toBeneficiaryCaseDetail } from './beneficiary-case-view';
import { slaHoursForCase } from './regional-sla';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { familyForServiceType } from './service-family';
import { AutomationEligibilityService } from '../automation/automation-eligibility.service';
import { UpdateServiceRequestDto } from './dto/update-service-request.dto';

const CASE_NUMBER_PREFIX = 'ASJ';

/** docs/FRONTEND_HANDOFF_V1_GAP_MAP.md §1's additive `ServiceFamily` layer
 * — attaches the derived family alongside the real `serviceType` on every
 * case shape this service returns, never replacing it. The `string` bound
 * (rather than the real `ServiceType` enum) accommodates
 * beneficiary-case-view.ts's own looser allowlist-projection typing; the
 * value is always a real column value at runtime either way. */
function withServiceFamily<T extends { serviceType: string }>(serviceCase: T): T & { serviceFamily: ReturnType<typeof familyForServiceType> } {
  return { ...serviceCase, serviceFamily: familyForServiceType(serviceCase.serviceType as ServiceType) };
}

// P0 Tech Platform §24 "SLA & Alert Engine" — "P0 operating hypotheses
// should be configurable, not hard-coded." Defaults are the spec's own
// hypotheses (standard site visit "within 24-72 hours"; PRIORITY/URGENT
// tighten from there) — every value is env-overridable per environment,
// same pattern as QUOTE_VALIDITY_HOURS/PAYMENT_EXPIRY_HOURS.
const DEFAULT_SLA_HOURS: Record<CasePriority, number> = {
  [CasePriority.STANDARD]: 72,
  [CasePriority.PRIORITY]: 48,
  [CasePriority.URGENT]: 24,
};

// Tier 2 vertical scoping ("SLA_HOURS_* keys only off CasePriority, not
// ServiceType — small real gap this exposes"): a handful of services are
// inherently urgent regardless of what a staff member happens to pick at
// triage — bereavement logistics chief among them. This only supplies the
// *default* when `dto.priority` is omitted; an explicit staff choice
// always wins (see convertToCase).
const SERVICE_TYPE_DEFAULT_PRIORITY: Partial<Record<ServiceType, CasePriority>> = {
  [ServiceType.BEREAVEMENT_SUPPORT]: CasePriority.URGENT,
};

/** Platform Expansion PRD §4.2 "Power of Attorney (PoA) Repository &
 * Verification" — "Introduces a VERIFIED_POA_REQUIRED guard on specific
 * service types." Scoped to the one service on the current catalogue
 * that's actually about acting on the customer's behalf at a government
 * registry (§6.2's Legal/Document Services vertical) — every other
 * service stays ungated rather than guessing PoA relevance for services
 * where it isn't the PRD's own stated use case. */
const VERIFIED_POA_REQUIRED_SERVICE_TYPES: ServiceType[] = [ServiceType.LEGAL_DOCUMENT_SERVICES];

function slaHoursForPriority(priority: CasePriority): number {
  const envVar = `SLA_HOURS_${priority}`;
  const configured = process.env[envVar];
  const parsed = configured ? Number(configured) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SLA_HOURS[priority];
}

// Staff roles that double as case-scoped collaborator roles (Section 4).
// ADMIN/SUPER_ADMIN are excluded — they already bypass CaseAccessGuard.
const COLLABORATOR_ROLE_BY_USER_ROLE: Partial<Record<Role, CollaboratorRole>> = {
  [Role.RELATIONSHIP_MANAGER]: CollaboratorRole.RELATIONSHIP_MANAGER,
  [Role.CASE_MANAGER]: CollaboratorRole.CASE_MANAGER,
  [Role.QUALITY_CONTROL]: CollaboratorRole.QUALITY_CONTROL,
  [Role.FINANCE]: CollaboratorRole.FINANCE,
  [Role.COMPLIANCE_RISK]: CollaboratorRole.COMPLIANCE_RISK,
};

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly idempotency: IdempotencyService,
    private readonly automationEligibility: AutomationEligibilityService,
  ) {}

  // -- Service requests (pre-case intake) ------------------------------

  /// docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 2 — idempotencyKey is
  /// optional; omitting it (every client before this existed) creates a
  /// request exactly as before. A client that supplies one and retries
  /// after e.g. a network timeout gets the original request back instead
  /// of a duplicate.
  async createServiceRequest(user: AuthenticatedUser, dto: CreateServiceRequestDto, idempotencyKey?: string) {
    if (idempotencyKey) {
      const check = await this.idempotency.begin(IdempotencyOperation.SERVICE_REQUEST_CREATE, idempotencyKey, user.id);
      if (!check.shouldProceed) {
        return this.prisma.serviceRequest.findUniqueOrThrow({ where: { id: check.resultReference! } });
      }
    }

    try {
      const created = await this.doCreateServiceRequest(user, dto);
      if (idempotencyKey) {
        await this.idempotency.complete(IdempotencyOperation.SERVICE_REQUEST_CREATE, idempotencyKey, user.id, created.id);
      }
      return created;
    } catch (err) {
      if (idempotencyKey) {
        await this.idempotency.fail(IdempotencyOperation.SERVICE_REQUEST_CREATE, idempotencyKey, user.id);
      }
      throw err;
    }
  }

  private async doCreateServiceRequest(user: AuthenticatedUser, dto: CreateServiceRequestDto) {
    const customer = await this.requireCustomerProfile(user.id);

    const request = await this.prisma.serviceRequest.create({
      data: {
        customerId: customer.id,
        rawDescription: dto.rawDescription,
        location: dto.location,
        channel: dto.channel,
        serviceType: dto.serviceType,
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'service_request.created',
      metadata: { serviceRequestId: request.id, channel: dto.channel },
    });

    // docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 3/4 — "wire the
    // eligibility check into the existing... service-request flow," now
    // extended to actually act on an AUTO decision (see
    // evaluateAutomationAndMaybeConvert below).
    await this.evaluateAutomationAndMaybeConvert(request.id);

    return request;
  }

  /**
   * Progressive enrichment of the same ServiceRequest a Concierge
   * conversation started (resolved decision #1 — this is
   * `StructuredRequest`). Re-evaluates the automation decision every
   * time, so a request that started CUSTOMER_INPUT for a missing field
   * can reach AUTO/ESCALATE/BLOCKED as soon as that field arrives.
   * Blocked once the request has already converted to a real Case — at
   * that point this is history, not a draft still being assembled.
   */
  async updateServiceRequest(user: AuthenticatedUser, requestId: string, dto: UpdateServiceRequestDto) {
    const customer = await this.requireCustomerProfile(user.id);
    const request = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!request || request.customerId !== customer.id) throw new NotFoundException('Service request not found');
    if (request.convertedCaseId) {
      throw new BadRequestException('This request has already been converted to a case');
    }

    const updated = await this.prisma.serviceRequest.update({
      where: { id: requestId },
      data: {
        ...(dto.serviceType !== undefined ? { serviceType: dto.serviceType } : {}),
        ...(dto.objective !== undefined ? { objective: dto.objective } : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
        ...(dto.timing !== undefined ? { timing: dto.timing } : {}),
        ...(dto.location !== undefined ? { location: dto.location } : {}),
        ...(dto.requirements !== undefined ? { requirements: dto.requirements as any } : {}),
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'service_request.updated',
      metadata: { serviceRequestId: requestId, fields: Object.keys(dto) },
    });

    await this.evaluateAutomationAndMaybeConvert(requestId);

    return updated;
  }

  /** Read-only — the current decision for one request. Customer (own
   * request only) or staff. */
  async getAutomationDecision(user: AuthenticatedUser, requestId: string) {
    const request = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Service request not found');
    if (user.role === Role.CUSTOMER) {
      const customer = await this.requireCustomerProfile(user.id);
      if (request.customerId !== customer.id) throw new NotFoundException('Service request not found');
    }
    return this.automationEligibility.getDecision(requestId);
  }

  /** Staff-only, on-demand — same "recompute without waiting" pattern as
   * every other sweep/recompute trigger in this codebase (e.g.
   * RiskEngineService's "Recompute risk level"). Useful after an
   * AutomationCapability/rule change to see its effect on an existing
   * request immediately. */
  async recomputeAutomationDecision(requestId: string) {
    const request = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Service request not found');
    return this.evaluateAutomationAndMaybeConvert(requestId);
  }

  async listServiceRequests(user: AuthenticatedUser) {
    if (user.role === Role.CUSTOMER) {
      const customer = await this.requireCustomerProfile(user.id);
      return this.prisma.serviceRequest.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
      });
    }
    // Staff: unconverted requests are the triage queue.
    return this.prisma.serviceRequest.findMany({
      where: { convertedCaseId: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Vertical slice 1: Request -> Case. Converts a triaged ServiceRequest
   * into a ServiceCase with no manual re-entry of what's already known.
   * Deterministic — called by staff, or by a validated AI tool-call, never
   * by the LLM writing to the database directly (Section 7.6).
   */
  async convertToCase(actor: AuthenticatedUser, requestId: string, dto: ConvertRequestDto) {
    const request = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Service request not found');
    if (request.convertedCaseId) {
      throw new NotFoundException('Service request has already been converted');
    }

    // Section 5.1 P1 — a saved beneficiary/property/asset may only be
    // attached if it actually belongs to this request's customer; a DTO
    // can't enforce that on its own.
    if (dto.beneficiaryId) {
      const beneficiary = await this.prisma.beneficiary.findUnique({ where: { id: dto.beneficiaryId } });
      if (!beneficiary || beneficiary.customerId !== request.customerId) {
        throw new BadRequestException('beneficiaryId does not belong to this customer');
      }
    }
    if (dto.propertyId) {
      const property = await this.prisma.property.findUnique({ where: { id: dto.propertyId } });
      if (!property || property.customerId !== request.customerId) {
        throw new BadRequestException('propertyId does not belong to this customer');
      }
    }
    if (dto.assetId) {
      const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
      if (!asset || asset.customerId !== request.customerId) {
        throw new BadRequestException('assetId does not belong to this customer');
      }
    }

    // Platform Expansion PRD §4.2 — VERIFIED_POA_REQUIRED guard. A
    // reusable, once-verified PoA (VaultModule's verifiedAsset.verify) is
    // the point — this only checks one already exists on file, it never
    // re-verifies or consumes it, so the same PoA covers every future
    // case of this type.
    if (VERIFIED_POA_REQUIRED_SERVICE_TYPES.includes(dto.serviceType)) {
      const verifiedPoa = await this.prisma.verifiedAsset.findFirst({
        where: { customerId: request.customerId, type: VaultCategory.POWER_OF_ATTORNEY, verified: true },
      });
      if (!verifiedPoa) {
        throw new BadRequestException(
          'This service requires a verified Power of Attorney on file — the customer must submit one to their vault and have staff verify it before this case can be created',
        );
      }
    }

    // Section 12 P1 "Concierge workflow" — a Concierge subscriber's cases
    // default to that tier unless staff explicitly override it.
    let tier = dto.tier;
    if (!tier) {
      const activeSubscription = await this.prisma.subscription.findFirst({
        where: { customerId: request.customerId, status: 'ACTIVE' },
      });
      tier = activeSubscription ? activeSubscription.tier : undefined;
    }

    // Some services (bereavement logistics) are inherently urgent
    // regardless of what a staff member happens to pick — see
    // SERVICE_TYPE_DEFAULT_PRIORITY. An explicit dto.priority always wins;
    // this only fills in what staff left unset.
    const priority = dto.priority ?? SERVICE_TYPE_DEFAULT_PRIORITY[dto.serviceType] ?? CasePriority.STANDARD;

    const created = await this.prisma.serviceCase.create({
      data: {
        // Placeholder, unique on its own — replaced with the real
        // ASJ-###### number below once we know the reserved `seq`.
        caseNumber: `PENDING-${randomUUID()}`,
        customerId: request.customerId,
        serviceType: dto.serviceType,
        description: dto.description,
        location: dto.location,
        priority,
        riskLevel: dto.riskLevel,
        tier,
        beneficiaryId: dto.beneficiaryId,
        propertyId: dto.propertyId,
        assetId: dto.assetId,
        status: CaseStatus.DRAFT,
        originRequest: { connect: { id: request.id } },
        slaTargetAt: new Date(Date.now() + slaHoursForCase(slaHoursForPriority(priority), dto.location) * 60 * 60 * 1000),
      },
    });

    const caseNumber = `${CASE_NUMBER_PREFIX}-${String(created.seq).padStart(6, '0')}`;
    const serviceCase = await this.prisma.serviceCase.update({
      where: { id: created.id },
      data: { caseNumber },
    });

    // Section 6.1 — every service gets its own version of the standard
    // field checklist, seeded onto the case the moment it exists so the
    // Field Agent App always has one to execute against.
    const checklist = CHECKLIST_TEMPLATES[dto.serviceType];
    await this.prisma.caseTask.createMany({
      data: checklist.map((item, index) => ({
        caseId: serviceCase.id,
        label: item.label,
        milestoneGroup: item.milestoneGroup,
        sortOrder: index,
      })),
    });

    await this.prisma.caseStatusHistory.create({
      data: { caseId: serviceCase.id, toStatus: CaseStatus.DRAFT, changedById: actor.id },
    });

    // The staff member who triages a request into a case needs a real,
    // case-scoped reason to act on it afterwards (Non-Negotiable #6) — role
    // membership alone won't pass CaseAccessGuard. Attach them here rather
    // than leaving every case they create inaccessible to them.
    const collaboratorRole = COLLABORATOR_ROLE_BY_USER_ROLE[actor.role];
    if (collaboratorRole) {
      await this.prisma.caseCollaborator.create({
        data: { caseId: serviceCase.id, userId: actor.id, role: collaboratorRole },
      });
    }

    await this.audit.record({
      caseId: serviceCase.id,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.created_from_request',
      metadata: { serviceRequestId: request.id },
    });

    return serviceCase;
  }

  /**
   * docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 3/4 — the one place that
   * decides "an AUTO decision actually creates the case now." Shared by
   * doCreateServiceRequest, updateServiceRequest, recomputeAutomationDecision,
   * and AiService.completeIntake (via CasesModule) so there's exactly one
   * call site making this decision, not four copies of the same `if`.
   * AutomationEligibilityService itself stays decision-and-audit-only —
   * its own contract ("AUTO never converts or creates anything") is
   * unchanged; this method is what turns that decision into an action.
   */
  async evaluateAutomationAndMaybeConvert(requestId: string) {
    const decision = await this.automationEligibility.evaluateAndRecord(requestId);
    if (decision.outcome === AutomationDecisionOutcome.AUTO) {
      await this.autoConvert(requestId);
    }
    return decision;
  }

  /**
   * docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 4 — the automated
   * counterpart to convertToCase, invoked only via
   * evaluateAutomationAndMaybeConvert above. Deliberately mirrors
   * convertToCase's own validation and creation logic rather than a
   * parallel path, minus the parts that need a human actor:
   * - No beneficiary/property/asset attachment — Concierge intake doesn't
   *   collect these yet, so there's nothing to validate.
   * - No CaseCollaborator self-attach — there's no actor to attach. The
   *   case lands unclaimed in the Ops triage queue exactly like any case
   *   does before a human first acts on it (same `GET /cases` unconverted
   *   queue, same `POST /cases/:caseId/claim` self-attach staff already
   *   use for a request they triage manually).
   * If the request is missing something convertToCase would otherwise
   * require (e.g. a future service type added to
   * VERIFIED_POA_REQUIRED_SERVICE_TYPES with no verified PoA on file),
   * this silently declines rather than throwing — same "not eligible yet,
   * fall back to staff" contract as PricingEngineService's {ok:false}
   * result elsewhere in this automation effort. A human converting
   * manually afterward is always the safety net, never a broken automated
   * path.
   */
  private async autoConvert(requestId: string): Promise<void> {
    const request = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!request || request.convertedCaseId) return; // already converted, or gone — nothing to do
    if (!request.serviceType || !request.location) return; // shouldn't happen if AUTO passed REQUIRED_FIELDS, but never assume

    if (VERIFIED_POA_REQUIRED_SERVICE_TYPES.includes(request.serviceType)) {
      const verifiedPoa = await this.prisma.verifiedAsset.findFirst({
        where: { customerId: request.customerId, type: VaultCategory.POWER_OF_ATTORNEY, verified: true },
      });
      if (!verifiedPoa) return;
    }

    const activeSubscription = await this.prisma.subscription.findFirst({
      where: { customerId: request.customerId, status: 'ACTIVE' },
    });
    const tier = activeSubscription ? activeSubscription.tier : undefined;
    const priority = SERVICE_TYPE_DEFAULT_PRIORITY[request.serviceType] ?? CasePriority.STANDARD;

    const created = await this.prisma.serviceCase.create({
      data: {
        caseNumber: `PENDING-${randomUUID()}`,
        customerId: request.customerId,
        serviceType: request.serviceType,
        description: request.objective ?? request.rawDescription,
        location: request.location,
        priority,
        tier,
        status: CaseStatus.DRAFT,
        originRequest: { connect: { id: request.id } },
        slaTargetAt: new Date(Date.now() + slaHoursForCase(slaHoursForPriority(priority), request.location) * 60 * 60 * 1000),
      },
    });

    const caseNumber = `${CASE_NUMBER_PREFIX}-${String(created.seq).padStart(6, '0')}`;
    const serviceCase = await this.prisma.serviceCase.update({
      where: { id: created.id },
      data: { caseNumber },
    });

    const checklist = CHECKLIST_TEMPLATES[request.serviceType];
    await this.prisma.caseTask.createMany({
      data: checklist.map((item, index) => ({
        caseId: serviceCase.id,
        label: item.label,
        milestoneGroup: item.milestoneGroup,
        sortOrder: index,
      })),
    });

    await this.prisma.caseStatusHistory.create({
      data: { caseId: serviceCase.id, toStatus: CaseStatus.DRAFT },
    });

    await this.audit.record({
      caseId: serviceCase.id,
      actorType: 'system',
      action: 'case.auto_converted',
      metadata: { serviceRequestId: request.id },
    });
  }

  /**
   * Section 12 P1 "recurring services" — the automatic counterpart to
   * convertToCase, used only by RecurringSchedulerService. There's no
   * ServiceRequest and no human actor behind this one; the audit trail
   * says so (actorType 'system', same convention as the payment webhook).
   */
  async spawnCaseFromSchedule(schedule: {
    id: string;
    customerId: string;
    serviceType: ServiceType;
    description: string;
    location: string;
    beneficiaryId: string | null;
    propertyId: string | null;
    assetId: string | null;
  }) {
    const created = await this.prisma.serviceCase.create({
      data: {
        caseNumber: `PENDING-${randomUUID()}`,
        customerId: schedule.customerId,
        serviceType: schedule.serviceType,
        description: schedule.description,
        location: schedule.location,
        beneficiaryId: schedule.beneficiaryId,
        propertyId: schedule.propertyId,
        assetId: schedule.assetId,
        status: CaseStatus.DRAFT,
        spawnedFromScheduleId: schedule.id,
        slaTargetAt: new Date(
          Date.now() + slaHoursForCase(slaHoursForPriority(CasePriority.STANDARD), schedule.location) * 60 * 60 * 1000,
        ),
      },
    });

    const caseNumber = `${CASE_NUMBER_PREFIX}-${String(created.seq).padStart(6, '0')}`;
    const serviceCase = await this.prisma.serviceCase.update({
      where: { id: created.id },
      data: { caseNumber },
    });

    const checklist = CHECKLIST_TEMPLATES[schedule.serviceType];
    await this.prisma.caseTask.createMany({
      data: checklist.map((item, index) => ({
        caseId: serviceCase.id,
        label: item.label,
        milestoneGroup: item.milestoneGroup,
        sortOrder: index,
      })),
    });

    await this.prisma.caseStatusHistory.create({
      data: { caseId: serviceCase.id, toStatus: CaseStatus.DRAFT },
    });

    await this.audit.record({
      caseId: serviceCase.id,
      actorType: 'system',
      action: 'case.spawned_from_schedule',
      metadata: { scheduleId: schedule.id },
    });

    return serviceCase;
  }

  // -- Cases -------------------------------------------------------------

  private static readonly OPS_ROLES: Role[] = [
    Role.CASE_MANAGER,
    Role.RELATIONSHIP_MANAGER,
    Role.QUALITY_CONTROL,
    Role.FINANCE,
    Role.COMPLIANCE_RISK,
    Role.ADMIN,
    Role.SUPER_ADMIN,
  ];

  private static readonly CASE_QUEUE_SUMMARY = {
    customer: { select: { fullName: true, userId: true } },
    assignments: {
      where: {
        status: {
          in: [AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED, AssignmentStatus.IN_PROGRESS],
        },
      },
      include: {
        agent: { select: { fullName: true } },
        provider: { select: { fullName: true } },
      },
    },
    // P0 Tech Platform §9 "Case Control Requirements" / UX Spec O01
    // "Command Center" — owner, next action and SLA target need to be
    // visible on the queue itself, not just the case detail page, or
    // "exceptions first" (the O01 design rule) has nothing to sort by.
    owner: { select: { email: true } },
    _count: { select: { riskFlags: true, incidents: true } },
  };

  async listCasesForUser(user: AuthenticatedUser) {
    if (user.role === Role.CUSTOMER) {
      const customer = await this.requireCustomerProfile(user.id);
      const cases = await this.prisma.serviceCase.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
      });
      return cases.map(withServiceFamily);
    }

    if (user.role === Role.BENEFICIARY) {
      // "Who is a Beneficiary" (portal access) — read-only, own-cases-only
      // summary list; getCaseDetail's BENEFICIARY branch is where the
      // curated per-case view actually lives.
      const beneficiary = await this.prisma.beneficiary.findUnique({ where: { userId: user.id } });
      if (!beneficiary) return [];
      const cases = await this.prisma.serviceCase.findMany({
        where: { beneficiaryId: beneficiary.id },
        select: { id: true, caseNumber: true, serviceType: true, status: true, location: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      return cases.map(withServiceFamily);
    }

    if (user.role === Role.FIELD_AGENT || user.role === Role.PROVIDER) {
      // Section 5.4 Field Agent App "job list" — include just this
      // person's own assignment(s) on each case so the UI has the
      // assignment id/status without a second round trip per case.
      const ownAssignmentFilter = {
        OR: [{ agent: { userId: user.id } }, { provider: { userId: user.id } }],
      };
      const cases = await this.prisma.serviceCase.findMany({
        where: { assignments: { some: ownAssignmentFilter } },
        include: { assignments: { where: ownAssignmentFilter } },
        orderBy: { updatedAt: 'desc' },
      });
      return cases.map(withServiceFamily);
    }

    // Ops Control Centre "case queue" (Section 5.3) is an org-wide
    // operational view by design — every internal role needs to see new
    // and in-flight cases to triage/pick them up, not just ones they
    // already hold a collaborator record on. This is deliberately broader
    // than Non-Negotiable #6's case-scoped rule, which governs *acting on*
    // a specific case (CaseAccessGuard, still enforced on detail/mutation
    // endpoints below) — not read-only visibility of the queue itself.
    if (CasesService.OPS_ROLES.includes(user.role)) {
      const cases = await this.prisma.serviceCase.findMany({
        include: CasesService.CASE_QUEUE_SUMMARY,
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });
      // Curated case file (independent readiness review, Section 7.1
      // follow-up): the queue is limited operational metadata by design
      // (see comment above), but for PII-restricted staff roles that
      // extends to the customer's name too — the case number is what they
      // work with, not who the customer is.
      return cases.map((c) => withServiceFamily({ ...c, customer: redactCustomerName(c.customer, user.role) }));
    }

    return [];
  }

  async getCaseDetail(actor: AuthenticatedUser, caseId: string) {
    // "Who is a Beneficiary" (portal access) — CaseAccessGuard already
    // proved this beneficiary is named on this exact case; this is the
    // *separate* question of what they're allowed to see once in. A
    // dedicated, tighter query (BENEFICIARY_CASE_SELECT), never the full
    // include below — defense in depth, not just response-shape
    // filtering (Section 11.2 / API Spec: never trust redaction alone).
    if (actor.role === Role.BENEFICIARY) {
      const beneficiaryCase = await this.prisma.serviceCase.findUnique({
        where: { id: caseId },
        select: BENEFICIARY_CASE_SELECT,
      });
      if (!beneficiaryCase) throw new NotFoundException('Case not found');
      return withServiceFamily(await toBeneficiaryCaseDetail(beneficiaryCase, (key) => this.storage.getViewUrl(key)));
    }

    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: {
        customer: { select: { fullName: true, userId: true } },
        owner: { select: { id: true, email: true, role: true } },
        tasks: { orderBy: { sortOrder: 'asc' } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        riskFlags: true,
        incidents: true,
        collaborators: { include: { user: { select: { email: true, role: true } } } },
        assignments: {
          include: {
            agent: { select: { userId: true, fullName: true } },
            provider: { select: { userId: true, fullName: true } },
          },
        },
        evidence: { include: { uploader: { select: { email: true } } } },
        documents: { orderBy: { createdAt: 'desc' } },
        reports: true,
        quotes: true,
        invoices: { include: { payments: true } },
        approvals: { orderBy: { createdAt: 'asc' } },
        rating: true,
        recurringSchedule: true,
        // docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 4 — the only extra
        // data the Ops case page's "Automated" badge needs (see
        // `autoConverted` below): whether the request this case came from
        // ever got an AUTO decision. Nothing here changes for a case with
        // no originRequest (recurring-schedule spawns) or one whose
        // request was never automation-eligible — outcome is just absent.
        originRequest: { select: { automationDecision: { select: { outcome: true } } } },
        /// P0 Technical Build Spec Section 22 "Job Card Engine" — "Generated
        /// only from approved scope... Contains exact tasks and
        /// exclusions... Contains evidence requirements." Full version
        /// history, same as `quotes`; it's the caller's job to pick the
        /// latest *confirmed* one as authoritative (an unconfirmed revision
        /// must never present as binding — Section 14's "cannot silently
        /// expand execution" applies here too), same as the Ops/customer
        /// scope cards already do via the dedicated /scope endpoint. This
        /// is what lets the Field Agent App show a real job card instead of
        /// having zero visibility into what was actually scoped/confirmed.
        scopes: { orderBy: { version: 'desc' } },
      },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');

    // Security hardening (independent readiness review, P0-04) — this
    // `include` fetches every document on the case regardless of who's
    // asking; CaseAccessGuard only proves the requester holds *some*
    // assignment here, not that they need every document. Field actors get
    // the same least-privilege filter DocumentsService applies on the
    // dedicated /documents endpoint; customer and staff are unrestricted.
    if (actor.role === Role.FIELD_AGENT || actor.role === Role.PROVIDER) {
      const ownAssignmentIds = new Set(
        serviceCase.assignments
          .filter((a) => a.agent?.userId === actor.id || a.provider?.userId === actor.id)
          .map((a) => a.id),
      );
      serviceCase.documents = filterDocumentsForFieldActor(serviceCase.documents, ownAssignmentIds);
    }

    // Curated case file: Case Manager / QC / Finance / Compliance-Risk get
    // the full operational record (tasks, evidence, documents, invoices)
    // but not the customer's real name — they act on the case, not on a
    // relationship with this person. RM/customer/admin see it unredacted.
    serviceCase.customer = redactCustomerName(serviceCase.customer, actor.role);

    // Never a predictable public URL (Section 11.2) — resolve a short-lived
    // signed view URL per file rather than exposing the raw storageKey.
    const [documentsWithView, evidenceWithView] = await Promise.all([
      Promise.all(
        serviceCase.documents.map(async (doc) => ({ ...doc, viewUrl: await this.storage.getViewUrl(doc.storageKey) })),
      ),
      Promise.all(
        serviceCase.evidence.map(async (item) => ({ ...item, viewUrl: await this.storage.getViewUrl(item.storageKey) })),
      ),
    ]);
    serviceCase.documents = documentsWithView as typeof serviceCase.documents;
    serviceCase.evidence = evidenceWithView as typeof serviceCase.evidence;

    return withServiceFamily(serviceCase);
  }

  /**
   * The only path by which a case's status may change. Validates against
   * the deterministic state machine, writes the status-history row, and
   * appends an audit event — every transition is fully traceable
   * (Non-Negotiables #9, #10).
   */
  async transitionCase(
    actor: AuthenticatedUser,
    caseId: string,
    toStatus: CaseStatus,
    reason?: string,
  ) {
    return this.applyTransition(caseId, toStatus, reason, actor.id, 'user');
  }

  /**
   * Same deterministic transition, but for a change driven by a verified
   * external event with no human actor behind it — e.g. a payment
   * provider's webhook (Non-Negotiable #4). `changedById`/`actorId` are
   * left null rather than pointed at a fake user, since AuditEvent.actorId
   * has a real foreign key to User.
   */
  async systemTransitionCase(caseId: string, toStatus: CaseStatus, reason?: string) {
    return this.applyTransition(caseId, toStatus, reason, undefined, 'system');
  }

  private async applyTransition(
    caseId: string,
    toStatus: CaseStatus,
    reason: string | undefined,
    actorId: string | undefined,
    actorType: 'user' | 'system',
  ) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');

    assertValidTransition(serviceCase.status, toStatus);

    const updated = await this.prisma.serviceCase.update({
      where: { id: caseId },
      data: { status: toStatus },
    });

    await this.prisma.caseStatusHistory.create({
      data: {
        caseId,
        fromStatus: serviceCase.status,
        toStatus,
        changedById: actorId,
        reason,
      },
    });

    await this.audit.record({
      caseId,
      actorId,
      actorType,
      action: 'case.status_transitioned',
      metadata: { from: serviceCase.status, to: toStatus, reason },
    });

    return updated;
  }

  /** Section 5.1 — Approve / Request clarification / Request additional work / Escalate. */
  async recordApproval(actor: AuthenticatedUser, caseId: string, action: ApprovalAction, note?: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const approval = await this.prisma.approval.create({
      data: { caseId, byUserId: actor.id, action, note },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.approval_recorded',
      metadata: { action, note },
    });

    // Deterministic follow-on transitions driven by the approval action.
    if (action === ApprovalAction.APPROVED && serviceCase.status === CaseStatus.CUSTOMER_REVIEW) {
      await this.transitionCase(actor, caseId, CaseStatus.APPROVED, 'Customer approved');
      // Nothing further requires human judgment once the customer has
      // approved the deliverable — move straight to Completed. Closing
      // (Completed -> Closed) stays a deliberate staff/finance action.
      await this.transitionCase(actor, caseId, CaseStatus.COMPLETED, 'Auto-completed after customer approval');
    } else if (
      action === ApprovalAction.REQUEST_ADDITIONAL_WORK &&
      serviceCase.status === CaseStatus.CUSTOMER_REVIEW
    ) {
      await this.transitionCase(actor, caseId, CaseStatus.ADDITIONAL_WORK, note ?? 'Customer requested additional work');
    }

    return approval;
  }

  /** Section 5.3 — Operations Control Centre: assign/reassign staff onto a case. */
  async addCollaborator(actor: AuthenticatedUser, caseId: string, userId: string, role: CollaboratorRole) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const collaborator = await this.prisma.caseCollaborator.upsert({
      where: { caseId_userId_role: { caseId, userId, role } },
      update: {},
      create: { caseId, userId, role },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.collaborator_added',
      metadata: { userId, role },
    });

    return collaborator;
  }

  /**
   * Self-service counterpart to addCollaborator: lets a staff member seen
   * browsing the org-wide queue (listCasesForUser) attach themselves to a
   * specific case — the "claim" action an Ops Console needs so triage
   * doesn't bottleneck on an admin. Only valid for roles that map onto a
   * CollaboratorRole; ADMIN/SUPER_ADMIN never need this since they bypass
   * CaseAccessGuard already.
   */
  async claimCase(actor: AuthenticatedUser, caseId: string) {
    const collaboratorRole = COLLABORATOR_ROLE_BY_USER_ROLE[actor.role];
    if (!collaboratorRole) {
      throw new BadRequestException('This role cannot claim cases');
    }
    return this.addCollaborator(actor, caseId, actor.id, collaboratorRole);
  }

  /**
   * P0 Tech Platform §9 "Case Control Requirements" — "who owns the case."
   * Distinct from CaseCollaborator (many staff can be attached; this is
   * the one person accountable). The target must be a real operational
   * staff member — never a customer or a field actor's own case queue.
   * Also ensures the new owner actually has case access: if their role
   * maps onto a CollaboratorRole and they aren't already attached, they're
   * added the same way claimCase does it, so assigning ownership doesn't
   * silently hand someone a case they then can't open (CaseAccessGuard).
   */
  async assignOwner(actor: AuthenticatedUser, caseId: string, ownerUserId: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const owner = await this.prisma.user.findUnique({ where: { id: ownerUserId } });
    if (!owner || !CasesService.OPS_ROLES.includes(owner.role)) {
      throw new BadRequestException('Case owner must be an operational staff member');
    }

    const updated = await this.prisma.serviceCase.update({
      where: { id: caseId },
      data: { ownerUserId },
    });

    const collaboratorRole = COLLABORATOR_ROLE_BY_USER_ROLE[owner.role];
    if (collaboratorRole) {
      await this.prisma.caseCollaborator.upsert({
        where: { caseId_userId_role: { caseId, userId: ownerUserId, role: collaboratorRole } },
        update: {},
        create: { caseId, userId: ownerUserId, role: collaboratorRole },
      });
    }

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.owner_assigned',
      metadata: { ownerUserId, previousOwnerUserId: serviceCase.ownerUserId },
    });

    return updated;
  }

  /**
   * P0 Tech Platform §9 "Case Control Requirements" — "what happens next,
   * when is it due." Plain free-text + an optional due date, not another
   * state machine; the case status already carries the formal workflow
   * position, this is the human-readable "what am I actually supposed to
   * do about this case right now."
   */
  async setNextAction(actor: AuthenticatedUser, caseId: string, nextAction: string, dueAt?: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const nextActionDueAt = dueAt ? new Date(dueAt) : null;
    const updated = await this.prisma.serviceCase.update({
      where: { id: caseId },
      data: { nextAction, nextActionDueAt },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.next_action_set',
      metadata: { nextAction, dueAt: nextActionDueAt },
    });

    return updated;
  }

  /**
   * P0 Tech Platform §8 "Case Status Model" — ON HOLD: "Blocked pending
   * information/decision/condition." Deliberately outside the static
   * TRANSITIONS map (case-state-machine.ts) — where a held case resumes
   * *to* is dynamic (wherever it was before), not a fixed edge, so this
   * manages CaseStatus.ON_HOLD directly rather than going through the
   * generic POST /transition, remembering the way back in
   * `heldFromStatus`. Reason is always required (HoldCaseDto) — never a
   * silent pause.
   */
  async holdCase(actor: AuthenticatedUser, caseId: string, reason: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (serviceCase.status === CaseStatus.ON_HOLD) {
      throw new BadRequestException('Case is already on hold');
    }
    if (serviceCase.status === CaseStatus.COMPLETED || serviceCase.status === CaseStatus.CLOSED) {
      throw new BadRequestException(`Cannot hold a case in status ${serviceCase.status}`);
    }

    const updated = await this.prisma.serviceCase.update({
      where: { id: caseId },
      data: { status: CaseStatus.ON_HOLD, heldFromStatus: serviceCase.status },
    });

    await this.prisma.caseStatusHistory.create({
      data: { caseId, fromStatus: serviceCase.status, toStatus: CaseStatus.ON_HOLD, changedById: actor.id, reason },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.held',
      metadata: { heldFromStatus: serviceCase.status, reason },
    });

    return updated;
  }

  /** Resumes a case from ON_HOLD back to whatever status it was in before
   * (`heldFromStatus`) — the counterpart to holdCase, same reasoning
   * about why this bypasses the static transition map. */
  async resumeCase(actor: AuthenticatedUser, caseId: string, reason?: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (serviceCase.status !== CaseStatus.ON_HOLD || !serviceCase.heldFromStatus) {
      throw new BadRequestException('Case is not on hold');
    }

    const resumeTo = serviceCase.heldFromStatus;
    const updated = await this.prisma.serviceCase.update({
      where: { id: caseId },
      data: { status: resumeTo, heldFromStatus: null },
    });

    await this.prisma.caseStatusHistory.create({
      data: { caseId, fromStatus: CaseStatus.ON_HOLD, toStatus: resumeTo, changedById: actor.id, reason },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.resumed',
      metadata: { resumedTo: resumeTo, reason },
    });

    return updated;
  }

  /**
   * "A case's checklist is fixed at creation time from checklist-templates.ts
   * — there's no UI yet to customize a checklist per case, only per service
   * type" (README). Every case still gets seeded from its service type's
   * template first — this only ever adds *on top* of that, for the
   * case-specific step no template could have predicted. Blocked once the
   * case is done (COMPLETED/CLOSED) — same reasoning as holdCase not
   * accepting a terminal-status case.
   */
  async addTask(actor: AuthenticatedUser, caseId: string, label: string, isRequired?: boolean) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (serviceCase.status === CaseStatus.COMPLETED || serviceCase.status === CaseStatus.CLOSED) {
      throw new BadRequestException(`Cannot add a checklist item to a case in status ${serviceCase.status}`);
    }

    const maxSortOrder = await this.prisma.caseTask.aggregate({ where: { caseId }, _max: { sortOrder: true } });
    const task = await this.prisma.caseTask.create({
      data: {
        caseId,
        label,
        isRequired: isRequired ?? true,
        sortOrder: (maxSortOrder._max.sortOrder ?? 0) + 1,
      },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case_task.added',
      metadata: { taskId: task.id, label, isRequired: task.isRequired },
    });

    return task;
  }

  /** Editing is only meaningful before the item is done — once a field
   * agent has actually completed a step, rewriting what it says (or
   * whether it was ever required) would rewrite the record of what
   * happened, not just plan ahead. completeTask (EvidenceService) is the
   * only way isComplete/completedAt ever change. */
  async updateTask(actor: AuthenticatedUser, caseId: string, taskId: string, label?: string, isRequired?: boolean) {
    const task = await this.prisma.caseTask.findUnique({ where: { id: taskId } });
    if (!task || task.caseId !== caseId) throw new NotFoundException('Checklist item not found on this case');
    if (task.isComplete) throw new BadRequestException('Cannot edit a checklist item that is already complete');
    if (label === undefined && isRequired === undefined) {
      throw new BadRequestException('Nothing to update — provide label and/or isRequired');
    }

    const updated = await this.prisma.caseTask.update({
      where: { id: taskId },
      data: { ...(label !== undefined ? { label } : {}), ...(isRequired !== undefined ? { isRequired } : {}) },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case_task.updated',
      metadata: { taskId, label, isRequired },
    });

    return updated;
  }

  /** Same "never touch a completed item" guard as updateTask — removing a
   * checklist item that's already been done would destroy the record that
   * it happened, not just tidy up the plan. */
  async removeTask(actor: AuthenticatedUser, caseId: string, taskId: string) {
    const task = await this.prisma.caseTask.findUnique({ where: { id: taskId } });
    if (!task || task.caseId !== caseId) throw new NotFoundException('Checklist item not found on this case');
    if (task.isComplete) throw new BadRequestException('Cannot remove a checklist item that is already complete');

    await this.prisma.caseTask.delete({ where: { id: taskId } });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case_task.removed',
      metadata: { taskId, label: task.label },
    });

    return { removed: true };
  }

  /** Section 3.1 — customer rejects the delivered report. Only reachable
   * from CUSTOMER_REVIEW (the report must actually be in front of them),
   * and — like holdCase/resumeCase — bypasses the static TRANSITIONS map
   * since DISPUTED is a side-status, not a normal forward step. Creates a
   * standalone Dispute record (structured reasons + its own resolution
   * lifecycle) rather than reusing Approval, which has no "team resolves
   * this later" concept. */
  async raiseDispute(actor: AuthenticatedUser, caseId: string, dto: RaiseDisputeDto) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (serviceCase.status !== CaseStatus.CUSTOMER_REVIEW) {
      throw new BadRequestException('Disputes can only be raised once a report is ready for your review');
    }

    // Structured gap form: every disputed item must actually be one of
    // this case's checklist tasks — no disputing tasks from another
    // case, no free-floating ids.
    const disputedTasks = await this.prisma.caseTask.findMany({
      where: { id: { in: dto.disputedTaskIds }, caseId },
      select: { id: true },
    });
    if (disputedTasks.length !== dto.disputedTaskIds.length) {
      throw new BadRequestException('One or more disputed items are not checklist tasks on this case');
    }

    const customer = await this.requireCustomerProfile(actor.id);
    const dispute = await this.prisma.dispute.create({
      data: {
        caseId,
        customerId: customer.id,
        disputedTaskIds: dto.disputedTaskIds,
        reasons: dto.reasons ?? [],
        notes: dto.notes,
      },
    });

    // Auto-generated rework: reopen exactly the disputed checklist items.
    // The existing checklist is the rework task the field agent already
    // works from — nothing else on the case is touched, so completed
    // items the customer didn't flag stay completed.
    await this.prisma.caseTask.updateMany({
      where: { id: { in: dto.disputedTaskIds }, caseId },
      data: { isComplete: false, completedAt: null },
    });

    await this.prisma.serviceCase.update({ where: { id: caseId }, data: { status: CaseStatus.DISPUTED } });
    await this.prisma.caseStatusHistory.create({
      data: {
        caseId,
        fromStatus: CaseStatus.CUSTOMER_REVIEW,
        toStatus: CaseStatus.DISPUTED,
        changedById: actor.id,
        reason: `Customer disputed ${dto.disputedTaskIds.length} checklist item(s)${dto.reasons?.length ? `: ${dto.reasons.join(', ')}` : ''}`,
      },
    });
    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.dispute_raised',
      metadata: { disputeId: dispute.id, disputedTaskIds: dto.disputedTaskIds, reasons: dto.reasons ?? [] },
    });
    await this.notifications.notify(
      actor.id,
      'Dispute filed',
      'The report has been locked and a rework on the disputed items has been scheduled.',
    );

    // Notify the originally-assigned field agent directly — they're the
    // one whose checklist just reopened, not just the ops queue.
    const fieldAssignment = await this.prisma.assignment.findFirst({
      where: { caseId, role: AssignmentRole.FIELD_AGENT, agentId: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: { agent: { select: { userId: true } } },
    });
    if (fieldAssignment?.agent) {
      await this.notifications.notify(
        fieldAssignment.agent.userId,
        'Rework needed — customer disputed part of your report',
        `${dto.disputedTaskIds.length} checklist item(s) were reopened for rework on case ${serviceCase.caseNumber}.`,
      );
    }

    return dispute;
  }

  /** Staff-side resolution — accepts the dispute and sends the case back
   * for rework. Only one OPEN dispute is expected per case at a time
   * (raiseDispute requires CUSTOMER_REVIEW, which a case can't re-enter
   * while DISPUTED), but this resolves the oldest open one defensively
   * rather than assuming exactly one exists. */
  async resolveDispute(actor: AuthenticatedUser, caseId: string, note?: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: { customer: true },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (serviceCase.status !== CaseStatus.DISPUTED) {
      throw new BadRequestException('Case is not disputed');
    }

    const dispute = await this.prisma.dispute.findFirst({
      where: { caseId, status: DisputeStatus.OPEN },
      orderBy: { createdAt: 'asc' },
    });
    if (dispute) {
      await this.prisma.dispute.update({
        where: { id: dispute.id },
        data: { status: DisputeStatus.RESOLVED, resolvedAt: new Date(), resolvedById: actor.id },
      });
    }

    await this.prisma.serviceCase.update({ where: { id: caseId }, data: { status: CaseStatus.ADDITIONAL_WORK } });
    await this.prisma.caseStatusHistory.create({
      data: {
        caseId,
        fromStatus: CaseStatus.DISPUTED,
        toStatus: CaseStatus.ADDITIONAL_WORK,
        changedById: actor.id,
        reason: note ?? 'Dispute accepted — rework scheduled on disputed items',
      },
    });
    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.dispute_resolved',
      metadata: { disputeId: dispute?.id, note },
    });
    await this.notifications.notify(
      serviceCase.customer.userId,
      'Dispute accepted — rework underway',
      "We've accepted your dispute and scheduled rework on the disputed items.",
    );

    return { ok: true };
  }

  private async requireCustomerProfile(userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundException('No customer profile for this user');
    return customer;
  }

  // ---------------------------------------------------------------------
  // Case messaging — CaseAccessGuard on the controller already establishes
  // the caller can see this case; this is just the Message model's CRUD.
  // ---------------------------------------------------------------------

  async listMessages(caseId: string) {
    return this.prisma.message.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: { id: true, email: true, role: true } } },
    });
  }

  async sendMessage(actor: AuthenticatedUser, caseId: string, body: string) {
    const message = await this.prisma.message.create({
      data: { caseId, senderId: actor.id, channel: 'web', body },
      include: { sender: { select: { id: true, email: true, role: true } } },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.message_sent',
      metadata: { messageId: message.id },
    });

    return message;
  }
}
