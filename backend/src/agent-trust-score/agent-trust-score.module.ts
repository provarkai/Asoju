import { Module } from '@nestjs/common';
import { AgentTrustScoreService } from './agent-trust-score.service';
import { AgentTrustScoreSchedulerService } from './agent-trust-score-scheduler.service';
import { AgentTrustScoreController } from './agent-trust-score.controller';

@Module({
  providers: [AgentTrustScoreService, AgentTrustScoreSchedulerService],
  controllers: [AgentTrustScoreController],
  exports: [AgentTrustScoreService],
})
export class AgentTrustScoreModule {}
