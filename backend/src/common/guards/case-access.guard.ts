import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Enforces Non-Negotiable #6: "No sensitive access without permission
 * (case-scoped, not just role-scoped)." Role membership alone (checked by
 * RolesGuard) is never sufficient to read/act on a *specific* case — this
 * guard additionally verifies the authenticated user has a real
 * relationship to the :caseId in the route:
 *   - CUSTOMER        -> must own the case
 *   - FIELD_AGENT     -> must hold an Assignment on the case
 *   - PROVIDER        -> must hold an Assignment on the case
 *   - BENEFICIARY     -> case's beneficiaryId must be their own Beneficiary
 *                     record (portal access — read-only, see
 *                     CasesService.getCaseDetail's BENEFICIARY branch for
 *                     what they're actually shown once past this gate)
 *   - RM/CASE_MANAGER/QUALITY_CONTROL/FINANCE/COMPLIANCE_RISK
 *                     -> must be an explicit CaseCollaborator on the case
 *   - ADMIN/SUPER_ADMIN -> full access (Section 4)
 */
@Injectable()
export class CaseAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const caseId = request.params?.caseId ?? request.params?.id;

    if (!user) return false;
    if (!caseId) {
      // No case in scope for this route — nothing for this guard to check.
      return true;
    }
    if (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN) {
      return true;
    }

    const serviceCase = await this.prisma.serviceCase.findUnique({
      where: { id: caseId },
      select: { id: true, beneficiaryId: true, customer: { select: { userId: true } } },
    });
    if (!serviceCase) throw new NotFoundException('Case not found');

    if (user.role === Role.CUSTOMER) {
      if (serviceCase.customer.userId === user.id) return true;
      throw new ForbiddenException('Not authorised for this case');
    }

    if (user.role === Role.BENEFICIARY) {
      const beneficiary = await this.prisma.beneficiary.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (beneficiary && serviceCase.beneficiaryId === beneficiary.id) return true;
      throw new ForbiddenException('Not authorised for this case');
    }

    if (user.role === Role.FIELD_AGENT || user.role === Role.PROVIDER) {
      const assignment = await this.prisma.assignment.findFirst({
        where: {
          caseId,
          OR: [{ agent: { userId: user.id } }, { provider: { userId: user.id } }],
        },
        select: { id: true },
      });
      if (assignment) return true;
      throw new ForbiddenException('Not assigned to this case');
    }

    // Staff roles: RM, Case Manager, QC, Finance, Compliance/Risk.
    const collaborator = await this.prisma.caseCollaborator.findFirst({
      where: { caseId, userId: user.id },
      select: { id: true },
    });
    if (collaborator) return true;

    throw new ForbiddenException('Not authorised for this case');
  }
}
