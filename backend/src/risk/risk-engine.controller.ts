import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RiskEngineService } from './risk-engine.service';

const RISK_REVIEW_ROLES = [Role.COMPLIANCE_RISK, Role.CASE_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class RiskEngineController {
  constructor(private readonly riskEngine: RiskEngineService) {}

  /** Org-wide, like the case queue (Section 5.3) — Compliance/Risk needs to
   * see every high-risk case, not just ones they already collaborate on. */
  @Roles(...RISK_REVIEW_ROLES)
  @Get('risk/flagged-cases')
  listHighRiskCases() {
    return this.riskEngine.listHighRiskCases();
  }

  @UseGuards(CaseAccessGuard)
  @Roles(...RISK_REVIEW_ROLES)
  @Get('cases/:caseId/risk-assessments')
  listAssessments(@Param('caseId') caseId: string) {
    return this.riskEngine.listAssessments(caseId);
  }

  @UseGuards(CaseAccessGuard)
  @Roles(...RISK_REVIEW_ROLES)
  @HttpCode(HttpStatus.OK)
  @Post('cases/:caseId/risk-assessment')
  assessCase(@Param('caseId') caseId: string) {
    return this.riskEngine.assessCase(caseId);
  }
}
