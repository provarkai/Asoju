import { Injectable, Logger } from '@nestjs/common';
import { AutomationDecisionOutcome, EscalationReasonCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EscalationService } from '../escalation/escalation.service';
import { evaluate } from './automation-evaluator';

/**
 * docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 3 — the DB-backed wrapper
 * around the pure evaluator: loads a ServiceRequest + its
 * AutomationCapability/rules, records the decision (upserted — one row
 * per request, re-evaluated as more structured detail arrives), and
 * (only for ESCALATE) creates a real Escalation so it surfaces in the
 * exact same staff-facing queue every other escalation does. "Resolve AUTO
 * at first to 'still requires staff convert'" — this service never creates,
 * converts, or acts on a Case; POST /service-requests/:id/convert (staff-
 * only) remains the only way a Case is ever created.
 */
@Injectable()
export class AutomationEligibilityService {
  private readonly logger = new Logger(AutomationEligibilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly escalation: EscalationService,
  ) {}

  /** Re-evaluates and upserts the decision for one ServiceRequest. Called
   * automatically on create and on every PATCH (CasesService), and
   * available as an on-demand staff trigger (same pattern as every other
   * sweep/recompute in this codebase) for re-checking after an
   * AutomationCapability/rule change. */
  async evaluateAndRecord(serviceRequestId: string) {
    const request = await this.prisma.serviceRequest.findUniqueOrThrow({ where: { id: serviceRequestId } });

    const capability = request.serviceType
      ? await this.prisma.automationCapability.findUnique({
          where: { serviceType: request.serviceType },
          include: { rules: { orderBy: { sortOrder: 'asc' } } },
        })
      : null;

    const result = evaluate(
      {
        serviceType: request.serviceType,
        objective: request.objective,
        location: request.location,
        timing: request.timing,
        rawDescription: request.rawDescription,
      },
      capability,
    );

    const existing = await this.prisma.automationDecision.findUnique({ where: { serviceRequestId } });

    // Only ESCALATE ever creates a real Escalation, and only once per
    // request — re-evaluating an already-escalated request (e.g. the
    // customer fills in more detail while a human is still reviewing it)
    // must never spawn a second one.
    let escalationId = existing?.escalationId ?? null;
    if (result.outcome === AutomationDecisionOutcome.ESCALATE && !escalationId) {
      const created = await this.escalation.createForServiceRequest(
        serviceRequestId,
        EscalationReasonCategory.AUTOMATION_UNAVAILABLE,
        "We're reviewing your request with a member of the team and will be in touch shortly.",
        result.reason,
      );
      escalationId = created.id;
    }

    const decision = await this.prisma.automationDecision.upsert({
      where: { serviceRequestId },
      create: {
        serviceRequestId,
        outcome: result.outcome,
        reason: result.reason,
        ruleResults: result.ruleResults as any,
        capabilityEnabled: result.capabilityEnabled,
        escalationId,
      },
      update: {
        outcome: result.outcome,
        reason: result.reason,
        ruleResults: result.ruleResults as any,
        capabilityEnabled: result.capabilityEnabled,
        escalationId,
        decidedAt: new Date(),
      },
    });

    await this.audit.record({
      actorType: 'system',
      action: 'automation_decision.recorded',
      metadata: { serviceRequestId, outcome: result.outcome, reason: result.reason },
    });

    return decision;
  }

  async getDecision(serviceRequestId: string) {
    return this.prisma.automationDecision.findUnique({ where: { serviceRequestId } });
  }
}
