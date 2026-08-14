import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AgentWalletService } from './agent-wallet.service';
import { RecordEarningDto } from './dto/record-earning.dto';
import { RecordPayoutDto } from './dto/record-payout.dto';

const FINANCE_ROLES = [Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AgentWalletController {
  constructor(private readonly wallet: AgentWalletService) {}

  @UseGuards(CaseAccessGuard)
  @Roles(...FINANCE_ROLES)
  @Post('cases/:caseId/agent-earnings')
  recordEarning(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: RecordEarningDto,
  ) {
    return this.wallet.recordEarning(user, caseId, dto);
  }

  @Roles(...FINANCE_ROLES)
  @Post('agents/:id/payouts')
  recordPayout(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RecordPayoutDto) {
    return this.wallet.recordPayout(user, id, dto);
  }

  @Roles(...FINANCE_ROLES, Role.FIELD_AGENT)
  @Get('agents/:id/wallet')
  getWallet(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.wallet.getWallet(user, id);
  }
}
