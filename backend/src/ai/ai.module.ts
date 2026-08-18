import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController, AiAssistantController, AiPublicController } from './ai.controller';
import { CasesModule } from '../cases/cases.module';

@Module({
  // CasesModule for CasesService.evaluateAutomationAndMaybeConvert —
  // docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 4, lets a completed
  // Concierge conversation reach automated case creation the same way
  // POST /service-requests already does. No cycle: CasesModule (and
  // everything it imports — IdempotencyModule, AutomationModule) has no
  // dependency back on AiModule.
  imports: [CasesModule],
  providers: [AiService],
  controllers: [AiController, AiAssistantController, AiPublicController],
  exports: [AiService],
})
export class AiModule {}
