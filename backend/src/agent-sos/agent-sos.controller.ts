import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AgentSosService } from './agent-sos.service';
import { TriggerSosDto } from './dto/trigger-sos.dto';
import { ResolveSosDto } from './dto/resolve-sos.dto';
import { EscalateSosDto } from './dto/escalate-sos.dto';

const STAFF_ROLES = [Role.CASE_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AgentSosController {
  constructor(private readonly sos: AgentSosService) {}

  @Roles(Role.FIELD_AGENT)
  @Post('agents/sos')
  trigger(@CurrentUser() user: AuthenticatedUser, @Body() dto: TriggerSosDto) {
    return this.sos.triggerSosAlert(user, dto);
  }

  @Roles(...STAFF_ROLES)
  @Post('agents/sos/:id/acknowledge')
  acknowledge(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sos.acknowledgeSosAlert(user, id);
  }

  @Roles(...STAFF_ROLES)
  @Post('agents/sos/:id/resolve')
  resolve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ResolveSosDto) {
    return this.sos.resolveSosAlert(user, id, dto.resolutionNotes);
  }

  @Roles(...STAFF_ROLES)
  @Post('agents/sos/:id/false-alarm')
  falseAlarm(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ResolveSosDto) {
    return this.sos.markFalseAlarm(user, id, dto.resolutionNotes);
  }

  @Roles(...STAFF_ROLES)
  @Post('agents/sos/:id/escalate')
  escalate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: EscalateSosDto) {
    return this.sos.escalateSosAlert(user, id, dto);
  }

  @Roles(...STAFF_ROLES)
  @Get('agents/sos/active')
  getActive() {
    return this.sos.getActiveAlerts();
  }

  @Roles(...STAFF_ROLES, Role.FIELD_AGENT)
  @Get('agents/sos/history')
  getHistory(@CurrentUser() user: AuthenticatedUser, @Query('agentId') agentId?: string, @Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : undefined;
    return this.sos.getAlertHistory(user, agentId, parsed && !Number.isNaN(parsed) ? parsed : undefined);
  }
}
