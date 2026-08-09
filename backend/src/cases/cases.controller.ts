import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CasesService } from './cases.service';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { ConvertRequestDto } from './dto/convert-request.dto';
import { TransitionCaseDto } from './dto/transition-case.dto';
import { ApprovalActionDto } from './dto/approval-action.dto';
import { AddCollaboratorDto } from './dto/add-collaborator.dto';

const STAFF_TRIAGE_ROLES = [Role.CASE_MANAGER, Role.RELATIONSHIP_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];
const STAFF_TRANSITION_ROLES = [Role.CASE_MANAGER, Role.QUALITY_CONTROL, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Roles(Role.CUSTOMER)
  @Post('service-requests')
  createServiceRequest(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateServiceRequestDto) {
    return this.casesService.createServiceRequest(user, dto);
  }

  @Get('service-requests')
  listServiceRequests(@CurrentUser() user: AuthenticatedUser) {
    return this.casesService.listServiceRequests(user);
  }

  @Roles(...STAFF_TRIAGE_ROLES)
  @Post('service-requests/:id/convert')
  convertToCase(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') requestId: string,
    @Body() dto: ConvertRequestDto,
  ) {
    return this.casesService.convertToCase(user, requestId, dto);
  }

  @Get('cases')
  listCases(@CurrentUser() user: AuthenticatedUser) {
    return this.casesService.listCasesForUser(user);
  }

  @UseGuards(CaseAccessGuard)
  @Get('cases/:id')
  getCase(@Param('id') id: string) {
    return this.casesService.getCaseDetail(id);
  }

  @Roles(...STAFF_TRANSITION_ROLES)
  @UseGuards(CaseAccessGuard)
  @Post('cases/:caseId/transition')
  transitionCase(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: TransitionCaseDto,
  ) {
    return this.casesService.transitionCase(user, caseId, dto.toStatus, dto.reason);
  }

  @Roles(Role.CUSTOMER)
  @UseGuards(CaseAccessGuard)
  @Post('cases/:caseId/approvals')
  recordApproval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: ApprovalActionDto,
  ) {
    return this.casesService.recordApproval(user, caseId, dto.action, dto.note);
  }

  // Restricted to admin: assigning a *new* staff member onto a case they
  // aren't already on would otherwise be blocked by CaseAccessGuard, so
  // this bypasses it deliberately via the ADMIN/SUPER_ADMIN role check
  // instead (Section 5.3 — Operations Control Centre "assign, reassign").
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('cases/:caseId/collaborators')
  addCollaborator(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: AddCollaboratorDto,
  ) {
    return this.casesService.addCollaborator(user, caseId, dto.userId, dto.role);
  }
}
