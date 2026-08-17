import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Agent, Evidence, Role, SosAlert } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

const OPS_STAFF: Role[] = [Role.ADMIN, Role.SUPER_ADMIN];
const FINANCE_STAFF: Role[] = [Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN];

/**
 * Centralized Broken-Object-Level-Authorization (BOLA/IDOR) guard —
 * ported from FieldForce's src/lib/bola.ts, adapted to Nest's
 * exception-based flow instead of its return-a-response-or-value union.
 *
 * `CaseAccessGuard` already centralizes ownership for every :caseId-scoped
 * route. This service covers the other resource types field agents reach
 * by :id — agent, evidence, SOS alert — where every call site used to
 * write its own `resource.userId !== actor.id` inline (three near-
 * identical copies existed before this: agent-wallet, agent-sos,
 * agent-financial-planning, each with a slightly different staff-role
 * list). One place to get "not found vs not yours" and the staff bypass
 * right, instead of every service re-deriving it — and occasionally
 * forgetting it on a new route.
 *
 * Every assert* method:
 *  - never trusts a client-supplied owner id, only the resolved resource
 *  - throws NotFoundException when the row genuinely doesn't exist
 *  - throws ForbiddenException when it exists but isn't the actor's and
 *    the actor isn't one of the allowed staff roles
 *  - returns the resource on success, so callers get it for free instead
 *    of re-fetching
 */
@Injectable()
export class OwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  /** :id is an Agent id — the actor must own it (Agent.userId) or be staff. */
  async assertAgentOwnership(
    actor: AuthenticatedUser,
    agentId: string,
    staffRoles: Role[] = FINANCE_STAFF,
  ): Promise<Agent> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    return this.assertOwnerOrStaff(actor, agent, agent?.userId ?? null, staffRoles, {
      notFound: 'Agent not found',
      forbidden: 'Not authorised for this agent',
    });
  }

  /** :id is an Evidence id — the actor must be its uploader or ops staff. */
  async assertEvidenceOwnership(
    actor: AuthenticatedUser,
    evidenceId: string,
    staffRoles: Role[] = OPS_STAFF,
  ): Promise<Evidence> {
    const evidence = await this.prisma.evidence.findUnique({ where: { id: evidenceId } });
    return this.assertOwnerOrStaff(actor, evidence, evidence?.uploaderId ?? null, staffRoles, {
      notFound: 'Evidence not found',
      forbidden: 'Not authorised for this evidence',
    });
  }

  /** :id is a SosAlert id — the actor must be the alerting agent or ops/case-manager staff. */
  async assertSosAlertOwnership(
    actor: AuthenticatedUser,
    alertId: string,
    staffRoles: Role[] = [...OPS_STAFF, Role.CASE_MANAGER],
  ): Promise<SosAlert> {
    const alert = await this.prisma.sosAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException('SOS alert not found');
    if (staffRoles.includes(actor.role)) return alert;

    const ownAgent = await this.prisma.agent.findUnique({ where: { userId: actor.id } });
    if (ownAgent && alert.agentId === ownAgent.id) return alert;
    throw new ForbiddenException('Not authorised for this SOS alert');
  }

  /**
   * The field-agent branch of CaseAccessGuard, reusable outside a
   * :caseId route param — #53's batch sync endpoint processes several
   * different caseIds in one request, so the route-level guard doesn't
   * fit; each queued item checks itself against this instead. Staff
   * bypass isn't offered here on purpose: this method exists specifically
   * for field-agent self-service actions.
   */
  async assertFieldAgentAssignedToCase(actor: AuthenticatedUser, caseId: string): Promise<void> {
    const assignment = await this.prisma.assignment.findFirst({
      where: { caseId, agent: { userId: actor.id } },
      select: { id: true },
    });
    if (!assignment) throw new ForbiddenException('Not assigned to this case');
  }

  /**
   * Resolves the actor's own Agent row (FIELD_AGENT self-service routes
   * that take no :id at all, e.g. "my history"). Staff pass their
   * client-supplied filter through unchanged; everyone else is pinned to
   * their own agent id regardless of what they asked for.
   */
  async resolveEffectiveAgentId(
    actor: AuthenticatedUser,
    requestedAgentId: string | undefined,
    staffRoles: Role[],
  ): Promise<string | undefined> {
    if (staffRoles.includes(actor.role)) return requestedAgentId;

    const ownAgent = await this.prisma.agent.findUnique({ where: { userId: actor.id } });
    if (!ownAgent) throw new ForbiddenException('Not authorised — no agent profile on this account');
    return ownAgent.id;
  }

  /**
   * The generic primitive every assert* above reduces to, exposed for
   * resource types that don't yet have a dedicated helper.
   */
  assertOwnerOrStaff<T>(
    actor: AuthenticatedUser,
    resource: T | null,
    ownerUserId: string | null,
    staffRoles: Role[],
    messages: { notFound: string; forbidden: string },
  ): T {
    if (!resource) throw new NotFoundException(messages.notFound);
    if (staffRoles.includes(actor.role)) return resource;
    if (ownerUserId && ownerUserId === actor.id) return resource;
    throw new ForbiddenException(messages.forbidden);
  }
}
