import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TrackingService } from './tracking.service';
import { ReportLocationDto } from './dto/report-location.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Roles(Role.FIELD_AGENT)
  @Post('assignments/:id/location')
  reportLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReportLocationDto,
  ) {
    return this.tracking.reportLocation(user, id, dto);
  }

  @Roles(Role.FIELD_AGENT, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('assignments/:id/track')
  getAssignmentTrack(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.tracking.getAssignmentTrack(user, id);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('agents/active-locations')
  getActiveAgentLocations() {
    return this.tracking.getActiveAgentLocations();
  }
}
