import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { SetAgentActiveDto } from './dto/set-agent-active.dto';

// Read access to the directory is broad — any internal ops role may need
// to see who's available (e.g. QC checking who worked a case). Onboarding
// and deactivation are admin-only (see method-level @Roles below).
const OPS_ROLES = [
  Role.CASE_MANAGER,
  Role.RELATIONSHIP_MANAGER,
  Role.QUALITY_CONTROL,
  Role.FINANCE,
  Role.COMPLIANCE_RISK,
  Role.ADMIN,
  Role.SUPER_ADMIN,
];

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...OPS_ROLES)
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  list() {
    return this.agentsService.listAgents();
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAgentDto) {
    return this.agentsService.createAgent(user, dto);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id/active')
  setActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetAgentActiveDto,
  ) {
    return this.agentsService.setAgentActive(user, id, dto.isActive);
  }
}
