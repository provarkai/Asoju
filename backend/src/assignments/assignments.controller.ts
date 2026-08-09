import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';

const STAFF_ASSIGN_ROLES = [Role.CASE_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Roles(...STAFF_ASSIGN_ROLES)
  @UseGuards(CaseAccessGuard)
  @Post('cases/:caseId/assignments')
  createAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.assignmentsService.createAssignment(user, caseId, dto);
  }

  @Roles(Role.FIELD_AGENT, Role.PROVIDER)
  @Post('assignments/:id/accept')
  acceptAssignment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.assignmentsService.acceptAssignment(user, id);
  }

  @Roles(Role.FIELD_AGENT, Role.PROVIDER)
  @Post('assignments/:id/decline')
  declineAssignment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.assignmentsService.declineAssignment(user, id);
  }
}
