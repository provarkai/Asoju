import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
import { AssignOwnerDto } from './dto/assign-owner.dto';
import { SetNextActionDto } from './dto/set-next-action.dto';
import { HoldCaseDto } from './dto/hold-case.dto';
import { ResumeCaseDto } from './dto/resume-case.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { RaiseDisputeDto } from './dto/raise-dispute.dto';
import { AddCaseTaskDto } from './dto/add-case-task.dto';
import { UpdateCaseTaskDto } from './dto/update-case-task.dto';

const STAFF_TRIAGE_ROLES = [Role.CASE_MANAGER, Role.RELATIONSHIP_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];
const STAFF_TRANSITION_ROLES = [Role.CASE_MANAGER, Role.QUALITY_CONTROL, Role.ADMIN, Role.SUPER_ADMIN];
const CLAIMABLE_ROLES = [
  Role.CASE_MANAGER,
  Role.RELATIONSHIP_MANAGER,
  Role.QUALITY_CONTROL,
  Role.FINANCE,
  Role.COMPLIANCE_RISK,
];
// Mirrors CasesService.OPS_ROLES — who's allowed to touch case
// ownership/next-action at all (the target of assign-owner is separately
// validated in the service to also be one of these roles).
const OPS_ROLES = [
  Role.CASE_MANAGER,
  Role.RELATIONSHIP_MANAGER,
  Role.QUALITY_CONTROL,
  Role.FINANCE,
  Role.COMPLIANCE_RISK,
  Role.ADMIN,
  Role.SUPER_ADMIN,
];
// Same staff set as scope.controller.ts's SCOPE_STAFF_ROLES — checklist
// customization is the same kind of case-planning action.
const CHECKLIST_STAFF_ROLES = [Role.CASE_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Roles(Role.CUSTOMER)
  @Post('service-requests')
  createServiceRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateServiceRequestDto,
    // docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 2 — optional; a client
    // that doesn't send this header gets the exact pre-existing behavior.
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.casesService.createServiceRequest(user, dto, idempotencyKey);
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

  // No CaseAccessGuard here on purpose — claiming is how a staff member
  // seen browsing the queue gets onto a case in the first place.
  @Roles(...CLAIMABLE_ROLES)
  @Post('cases/:caseId/claim')
  claimCase(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string) {
    return this.casesService.claimCase(user, caseId);
  }

  @UseGuards(CaseAccessGuard)
  @Get('cases/:id')
  getCase(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.casesService.getCaseDetail(user, id);
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

  /** P0 Tech Platform §9 "Case Control Requirements" / API Spec
   * `POST /cases/{case_id}/assign-owner`. CaseAccessGuard so only someone
   * who already has a reason to be on the case can (re)assign its owner —
   * same access model as transition/next-action. */
  @Roles(...OPS_ROLES)
  @UseGuards(CaseAccessGuard)
  @Post('cases/:caseId/assign-owner')
  assignOwner(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string, @Body() dto: AssignOwnerDto) {
    return this.casesService.assignOwner(user, caseId, dto.ownerUserId);
  }

  /** P0 Tech Platform §9 "Case Control Requirements" / API Spec
   * `PATCH /cases/{case_id}` next-action fields — implemented as its own
   * command rather than folded into a general case PATCH, same reasoning
   * as every other material action in this controller: explicit intent,
   * explicit audit event. */
  @Roles(...OPS_ROLES)
  @UseGuards(CaseAccessGuard)
  @Post('cases/:caseId/next-action')
  setNextAction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: SetNextActionDto,
  ) {
    return this.casesService.setNextAction(user, caseId, dto.nextAction, dto.dueAt);
  }

  /** P0 Tech Platform §8 "Case Status Model" / API Spec `POST
   * /cases/{case_id}/hold`. Reason required (HoldCaseDto). */
  @Roles(...OPS_ROLES)
  @UseGuards(CaseAccessGuard)
  @Post('cases/:caseId/hold')
  holdCase(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string, @Body() dto: HoldCaseDto) {
    return this.casesService.holdCase(user, caseId, dto.reason);
  }

  /** Counterpart to holdCase — resumes to wherever the case was before. */
  @Roles(...OPS_ROLES)
  @UseGuards(CaseAccessGuard)
  @Post('cases/:caseId/resume')
  resumeCase(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string, @Body() dto: ResumeCaseDto) {
    return this.casesService.resumeCase(user, caseId, dto.reason);
  }

  /** Section 3.1 — customer rejects the delivered report with specific,
   * structured reasons (distinct from the lighter REQUEST_ADDITIONAL_WORK
   * approval action — see raiseDispute's docstring). */
  @Roles(Role.CUSTOMER)
  @UseGuards(CaseAccessGuard)
  @Post('cases/:caseId/dispute')
  raiseDispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: RaiseDisputeDto,
  ) {
    return this.casesService.raiseDispute(user, caseId, dto);
  }

  /** Staff-side: accepts the dispute and schedules rework. */
  @Roles(...OPS_ROLES)
  @UseGuards(CaseAccessGuard)
  @Post('cases/:caseId/dispute/resolve')
  resolveDispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: ResumeCaseDto,
  ) {
    return this.casesService.resolveDispute(user, caseId, dto.reason);
  }

  // -------------------------------------------------------------------
  // Per-case checklist customization — the fixed service-type template
  // (checklist-templates.ts) always seeds the case first; these only add
  // on top of it for something specific to this case the template
  // couldn't have predicted. Never touches an already-complete item —
  // completeTask (EvidenceController) is the only route that can.
  // -------------------------------------------------------------------

  @Roles(...CHECKLIST_STAFF_ROLES)
  @UseGuards(CaseAccessGuard)
  @Post('cases/:caseId/tasks')
  addTask(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string, @Body() dto: AddCaseTaskDto) {
    return this.casesService.addTask(user, caseId, dto.label, dto.isRequired);
  }

  @Roles(...CHECKLIST_STAFF_ROLES)
  @UseGuards(CaseAccessGuard)
  @Patch('cases/:caseId/tasks/:taskId')
  updateTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateCaseTaskDto,
  ) {
    return this.casesService.updateTask(user, caseId, taskId, dto.label, dto.isRequired);
  }

  @Roles(...CHECKLIST_STAFF_ROLES)
  @UseGuards(CaseAccessGuard)
  @Delete('cases/:caseId/tasks/:taskId')
  removeTask(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string, @Param('taskId') taskId: string) {
    return this.casesService.removeTask(user, caseId, taskId);
  }

  // -------------------------------------------------------------------
  // Case messaging — any role CaseAccessGuard already lets onto the case
  // (customer, staff collaborator, or bypass-eligible admin) can read and
  // post; there's no separate messaging-specific role restriction.
  // -------------------------------------------------------------------

  @UseGuards(CaseAccessGuard)
  @Get('cases/:caseId/messages')
  listMessages(@Param('caseId') caseId: string) {
    return this.casesService.listMessages(caseId);
  }

  @UseGuards(CaseAccessGuard)
  @Post('cases/:caseId/messages')
  sendMessage(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string, @Body() dto: SendMessageDto) {
    return this.casesService.sendMessage(user, caseId, dto.body);
  }
}
