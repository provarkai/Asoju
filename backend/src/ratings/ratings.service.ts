import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AssignmentRole, CaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

/**
 * Section 12 P1 — "provider performance scoring". A customer rates a
 * completed case once; the score rolls up into the assigned agent's/
 * provider's rolling performanceScore, giving the Ops Console something
 * more informative than "this is our agent" (Gate 1-16 working session,
 * "Provider Verification").
 */
@Injectable()
export class RatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async rateCase(actor: AuthenticatedUser, caseId: string, stars: number, comment?: string, publicConsent?: boolean) {
    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      include: { assignments: true, rating: true },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');

    const ratableStatuses: CaseStatus[] = [CaseStatus.COMPLETED, CaseStatus.CLOSED];
    if (!ratableStatuses.includes(serviceCase.status)) {
      throw new BadRequestException('Only a completed case can be rated');
    }
    if (serviceCase.rating) {
      throw new ConflictException('This case has already been rated');
    }

    const rating = await this.prisma.rating.create({
      data: { caseId, byUserId: actor.id, stars, comment, publicConsent: publicConsent ?? false },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.rated',
      metadata: { stars, ratingId: rating.id },
    });

    // Roll the new rating into whoever actually did the work.
    for (const assignment of serviceCase.assignments) {
      if (assignment.role === AssignmentRole.FIELD_AGENT && assignment.agentId) {
        await this.recomputeAgentScore(assignment.agentId);
      }
      if (assignment.role === AssignmentRole.PROVIDER && assignment.providerId) {
        await this.recomputeProviderScore(assignment.providerId);
      }
    }

    return rating;
  }

  private async recomputeAgentScore(agentId: string) {
    const result = await this.prisma.rating.aggregate({
      _avg: { stars: true },
      where: { case: { assignments: { some: { agentId } } } },
    });
    await this.prisma.agent.update({
      where: { id: agentId },
      data: { performanceScore: result._avg.stars },
    });
  }

  private async recomputeProviderScore(providerId: string) {
    const result = await this.prisma.rating.aggregate({
      _avg: { stars: true },
      where: { case: { assignments: { some: { providerId } } } },
    });
    await this.prisma.provider.update({
      where: { id: providerId },
      data: { performanceScore: result._avg.stars },
    });
  }
}
