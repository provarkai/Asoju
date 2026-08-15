import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { EscalationStatus, Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { EscalationService } from './escalation.service';
import { CreateEscalationDto } from './dto/create-escalation.dto';
import { AssignEscalationDto } from './dto/assign-escalation.dto';
import { ResolveEscalationDto } from './dto/resolve-escalation.dto';

// Same staff-role set as EscalationService's OPS_ROLES — duplicated per
// this codebase's existing convention (cases.controller.ts's OPS_ROLES,
// commerce.controller.ts's STAFF_QUOTE_ROLES, etc.).
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
@Controller()
export class EscalationController {
  constructor(private readonly escalationService: EscalationService) {}

  /** CaseAccessGuard here (not a bare OPS_ROLES check) since escalations
   * are created off a specific case and only someone with a reason to be
   * on that case — staff collaborator or the case's owning customer's
   * assigned staff — should be able to raise one. */
  @Roles(...OPS_ROLES)
  @UseGuards(CaseAccessGuard)
  @Post('cases/:caseId/escalations')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: CreateEscalationDto,
  ) {
    return this.escalationService.create(user, caseId, dto);
  }

  /** Customer + staff — CaseAccessGuard restricts to case owner or
   * collaborator/admin; EscalationService.listForCase curates the
   * response down to customer-safe fields when the viewer isn't staff. */
  @UseGuards(CaseAccessGuard)
  @Get('cases/:caseId/escalations')
  listForCase(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string) {
    return this.escalationService.listForCase(caseId, user.role);
  }

  /** Staff triage queue, optionally filtered by status. */
  @Roles(...OPS_ROLES)
  @Get('escalations')
  list(@Query('status') status?: EscalationStatus) {
    return this.escalationService.list(status);
  }

  /** Staff-only detail — every field, including internalReason. */
  @Roles(...OPS_ROLES)
  @Get('escalations/:id')
  findOne(@Param('id') id: string) {
    return this.escalationService.findOne(id);
  }

  @Roles(...OPS_ROLES)
  @Post('escalations/:id/assign')
  assign(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AssignEscalationDto) {
    return this.escalationService.assign(user, id, dto);
  }

  @Roles(...OPS_ROLES)
  @Post('escalations/:id/resolve')
  resolve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ResolveEscalationDto) {
    return this.escalationService.resolve(user, id, dto);
  }

  @Roles(...OPS_ROLES)
  @Post('escalations/:id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ResolveEscalationDto) {
    return this.escalationService.cancel(user, id, dto.resolutionNotes);
  }
}
