import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PredictiveCostingService } from './predictive-costing.service';

// Same staff who build/see the quote (commerce.controller.ts's
// STAFF_QUOTE_ROLES) — predicted direct cost is exactly the margin signal
// they need before setting quote lines.
const STAFF_QUOTE_ROLES = [Role.CASE_MANAGER, Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
@Roles(...STAFF_QUOTE_ROLES)
@Controller()
export class PredictiveCostingController {
  constructor(private readonly predictiveCosting: PredictiveCostingService) {}

  /** Platform Expansion PRD §5.3 — a historical-average direct-cost
   * estimate for this case's service type + region, before staff finalize
   * a quote. Informational only. */
  @Get('cases/:caseId/predicted-cost')
  predictedCost(@Param('caseId') caseId: string) {
    return this.predictiveCosting.predictDirectCostForCase(caseId);
  }
}
