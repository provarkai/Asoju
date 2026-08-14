import { Module } from '@nestjs/common';
import { AgentFinancialPlanningService } from './agent-financial-planning.service';
import { AgentFinancialPlanningController } from './agent-financial-planning.controller';

@Module({
  providers: [AgentFinancialPlanningService],
  controllers: [AgentFinancialPlanningController],
  exports: [AgentFinancialPlanningService],
})
export class AgentFinancialPlanningModule {}
