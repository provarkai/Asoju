import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { OwnershipService } from '../common/ownership/ownership.service';
import { AgentWalletService } from './agent-wallet.service';
import { LedgerService } from './ledger.service';
import { RecordEarningDto } from './dto/record-earning.dto';
import { RecordPayoutDto } from './dto/record-payout.dto';

const FINANCE_ROLES = [Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AgentWalletController {
  constructor(
    private readonly wallet: AgentWalletService,
    private readonly ledger: LedgerService,
    private readonly ownership: OwnershipService,
  ) {}

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

  /** #52 — ops-only whole-ledger view: one row per control account, with
   * the debits/credits/balance a trial balance is for — the reconciliation
   * check the double-entry ledger exists to make possible. */
  @Roles(...FINANCE_ROLES)
  @Get('ledger/trial-balance')
  getTrialBalance() {
    return this.ledger.getTrialBalance();
  }

  /** #52 — the subsidiary-ledger drill-down behind a wallet balance: every
   * journal entry posted against this agent, across both control accounts. */
  @Roles(...FINANCE_ROLES, Role.FIELD_AGENT)
  @Get('agents/:id/ledger')
  async getAgentLedger(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.ownership.assertAgentOwnership(user, id);
    return this.ledger.getAgentLedger(id);
  }
}
