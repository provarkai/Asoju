import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateScopeDto } from './dto/create-scope.dto';

/**
 * P0 Technical Build Spec Section 14 "Scope Versioning" / P0 Engineering
 * Backlog EPIC F — "material scope changes create a traceable new version
 * and cannot silently expand execution." A case's scope is what the
 * customer actually confirmed before ever seeing a price; CommerceService
 * gates quote creation on the latest version being confirmed (see the
 * comment there) so the sequence is always scope → confirm → quote, never
 * quote-first with scope as an afterthought.
 */
@Injectable()
export class ScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async getLatest(caseId: string) {
    return this.prisma.caseScope.findFirst({ where: { caseId }, orderBy: { version: 'desc' } });
  }

  async listVersions(caseId: string) {
    return this.prisma.caseScope.findMany({ where: { caseId }, orderBy: { version: 'desc' } });
  }

  /**
   * Always inserts a new version rather than mutating one in place — a
   * revision after the customer already confirmed a version starts
   * unconfirmed again, on purpose (P0 UX Spec: "Scope changes require
   * explicit confirmation").
   */
  async createOrRevise(actor: AuthenticatedUser, caseId: string, dto: CreateScopeDto) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: { customer: true },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const last = await this.getLatest(caseId);
    const version = (last?.version ?? 0) + 1;

    const scope = await this.prisma.caseScope.create({
      data: {
        caseId,
        version,
        objective: dto.objective,
        tasks: dto.tasks,
        deliverables: dto.deliverables ?? [],
        exclusions: dto.exclusions ?? [],
        evidenceRequirements: dto.evidenceRequirements ?? [],
        createdById: actor.id,
      },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'scope.created',
      metadata: { scopeId: scope.id, version, taskCount: dto.tasks.length },
    });
    await this.notifications.notify(
      serviceCase.customer.userId,
      version === 1 ? 'Please review the scope for your case' : 'The scope for your case has been revised',
      `Review exactly what's included${version > 1 ? ' — this replaces the previous version' : ''} and confirm it so we can quote.`,
    );

    return scope;
  }

  /** Customer-only, and only the customer who owns the case — enforced
   * here in addition to CaseAccessGuard so a staff collaborator (who also
   * passes CaseAccessGuard) can never confirm on the customer's behalf. */
  async confirm(actor: AuthenticatedUser, caseId: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: { customer: true },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (serviceCase.customer.userId !== actor.id) {
      throw new ForbiddenException('Only the case owner can confirm scope');
    }

    const latest = await this.getLatest(caseId);
    if (!latest) throw new BadRequestException('No scope has been proposed for this case yet');
    if (latest.confirmedAt) return latest; // idempotent — confirming twice is a no-op, not an error

    const confirmed = await this.prisma.caseScope.update({
      where: { id: latest.id },
      data: { confirmedById: actor.id, confirmedAt: new Date() },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'scope.confirmed',
      metadata: { scopeId: latest.id, version: latest.version },
    });

    return confirmed;
  }
}
