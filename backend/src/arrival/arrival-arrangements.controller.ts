import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ArrivalService } from './arrival.service';
import { CreateArrivalArrangementDto } from './dto/create-arrival-arrangement.dto';
import { TransitionArrivalArrangementDto } from './dto/transition-arrival-arrangement.dto';

// Same staff set as CasesController's STAFF_TRIAGE_ROLES — coordinating a
// real transport/accommodation vendor off-platform is a case-management
// action, not a general ops one. There is no self-service provider portal
// for this (see the model's own schema comment) — only staff write here.
const ARRIVAL_STAFF_ROLES = [Role.CASE_MANAGER, Role.RELATIONSHIP_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
@Controller('cases/:caseId/arrival-arrangements')
export class ArrivalArrangementsController {
  constructor(private readonly arrivalService: ArrivalService) {}

  /** No @Roles — anyone CaseAccessGuard already lets onto the case
   * (customer, staff collaborator, assigned agent) can read arrangement
   * status; only staff can create or transition one. */
  @Get()
  list(@Param('caseId') caseId: string) {
    return this.arrivalService.listArrangements(caseId);
  }

  @Roles(...ARRIVAL_STAFF_ROLES)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: CreateArrivalArrangementDto,
  ) {
    return this.arrivalService.createArrangement(user, caseId, dto.type, dto.detail);
  }

  @Roles(...ARRIVAL_STAFF_ROLES)
  @Patch(':arrangementId')
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Param('arrangementId') arrangementId: string,
    @Body() dto: TransitionArrivalArrangementDto,
  ) {
    return this.arrivalService.transitionArrangement(user, caseId, arrangementId, dto.status, dto.detail, dto.note);
  }
}
