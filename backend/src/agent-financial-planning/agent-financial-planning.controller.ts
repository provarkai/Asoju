import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AgentFinancialPlanningService } from './agent-financial-planning.service';

const FINANCE_ROLES = [Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AgentFinancialPlanningController {
  constructor(private readonly financialPlanning: AgentFinancialPlanningService) {}

  @Roles(...FINANCE_ROLES, Role.FIELD_AGENT)
  @Get('agents/:id/financial-plan')
  getFinancialPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('monthsBack') monthsBack?: string,
  ) {
    const parsed = monthsBack ? parseInt(monthsBack, 10) : undefined;
    return this.financialPlanning.getFinancialPlan(
      user,
      id,
      parsed && !Number.isNaN(parsed) && parsed > 0 ? parsed : undefined,
    );
  }
}
