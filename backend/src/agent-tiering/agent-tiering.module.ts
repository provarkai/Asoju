import { Module } from '@nestjs/common';
import { AgentTieringService } from './agent-tiering.service';
import { AgentTieringSchedulerService } from './agent-tiering-scheduler.service';
import { AgentTieringController } from './agent-tiering.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  providers: [AgentTieringService, AgentTieringSchedulerService, CaseAccessGuard],
  controllers: [AgentTieringController],
  exports: [AgentTieringService],
})
export class AgentTieringModule {}
