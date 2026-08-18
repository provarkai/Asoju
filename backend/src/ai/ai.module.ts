import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController, AiAssistantController, AiPublicController } from './ai.controller';
import { CasesModule } from '../cases/cases.module';
import { AiKnowledgeModule } from '../ai-knowledge/ai-knowledge.module';

@Module({
  // CasesModule for CasesService.evaluateAutomationAndMaybeConvert —
  // docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 4, lets a completed
  // Concierge conversation reach automated case creation the same way
  // POST /service-requests already does. AiKnowledgeModule for
  // AiKnowledgeService.buildContextBlock() — "teach the AI the prices and
  // customer service" — grounds every turn in staff-authored knowledge +
  // live pricing instead of the frozen system prompt alone. No cycle:
  // neither module (nor anything they import) depends back on AiModule.
  imports: [CasesModule, AiKnowledgeModule],
  providers: [AiService],
  controllers: [AiController, AiAssistantController, AiPublicController],
  exports: [AiService],
})
export class AiModule {}
