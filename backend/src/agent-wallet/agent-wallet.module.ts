import { Module } from '@nestjs/common';
import { AgentWalletService } from './agent-wallet.service';
import { AgentWalletController } from './agent-wallet.controller';

@Module({
  providers: [AgentWalletService],
  controllers: [AgentWalletController],
  exports: [AgentWalletService],
})
export class AgentWalletModule {}
