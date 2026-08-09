import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { RecurringService } from './recurring.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { SetActiveDto } from './dto/set-active.dto';

const STAFF_ROLES = [Role.CASE_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

@Controller()
export class RecurringController {
  constructor(private readonly recurringService: RecurringService) {}

  @UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
  @Roles(...STAFF_ROLES)
  @Post('cases/:caseId/recurrence')
  setup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.recurringService.setup(user, caseId, dto.cadenceDays);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
  @Roles(...STAFF_ROLES)
  @Patch('cases/:caseId/recurrence')
  setActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: SetActiveDto,
  ) {
    return this.recurringService.setActive(user, caseId, dto.active);
  }

  // Ops-facing manual trigger — the real trigger is the daily cron
  // (RecurringSchedulerService), this exists so staff aren't stuck waiting
  // a day to confirm a schedule works, and so it can be forced after
  // downtime.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('admin/recurring/run')
  runDueSchedules() {
    return this.recurringService.processDueSchedules();
  }
}
