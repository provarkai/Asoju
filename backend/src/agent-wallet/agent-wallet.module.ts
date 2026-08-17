import { Module } from '@nestjs/common';
import { AgentWalletService } from './agent-wallet.service';
import { AgentWalletController } from './agent-wallet.controller';
import { LedgerService } from './ledger.service';

@Module({
  providers: [AgentWalletService, LedgerService],
  controllers: [AgentWalletController],
  exports: [AgentWalletService, LedgerService],
})
export class AgentWalletModule {}
