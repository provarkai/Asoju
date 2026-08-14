import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AgentTieringService } from './agent-tiering.service';

// Same staff who can actually create an assignment (assignments.controller.ts)
// — a suggestion list is only useful to whoever picks the agent.
const STAFF_ASSIGN_ROLES = [Role.CASE_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AgentTieringController {
  constructor(private readonly tiering: AgentTieringService) {}

  /** Platform Expansion PRD §5.1 — tier as "a weighting factor in the
   * assignment algorithm", informational only: staff still picks the
   * agent via POST cases/:caseId/assignments. */
  @Roles(...STAFF_ASSIGN_ROLES)
  @UseGuards(CaseAccessGuard)
  @Get('cases/:caseId/agent-suggestions')
  suggestAgents(@Param('caseId') caseId: string) {
    return this.tiering.suggestAgentsForCase(caseId);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('admin/agent-tiering/run')
  runTieringSweep() {
    return this.tiering.recomputeAllTiers();
  }
}
