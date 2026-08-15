import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AgentTrustScoreService } from './agent-trust-score.service';

const STAFF_ROLES = [Role.CASE_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AgentTrustScoreController {
  constructor(private readonly trustScore: AgentTrustScoreService) {}

  @Roles(...STAFF_ROLES, Role.FIELD_AGENT)
  @Get('agents/:id/trust-score')
  getTrustProfile(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trustScore.getTrustProfile(user, id);
  }

  @Roles(...STAFF_ROLES)
  @Get('agents/trust-leaderboard')
  getLeaderboard(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : undefined;
    return this.trustScore.getLeaderboard(parsed && !Number.isNaN(parsed) ? parsed : undefined);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('admin/agent-trust-score/run')
  runTrustScoreSweep() {
    return this.trustScore.recomputeAllTrustScores();
  }
}
