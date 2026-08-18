import { Module } from '@nestjs/common';
import { AiKnowledgeService } from './ai-knowledge.service';
import { AiKnowledgeController } from './ai-knowledge.controller';
import { PricingEngineModule } from '../pricing-engine/pricing-engine.module';

@Module({
  // PricingEngineModule for getActivePricingCatalogSummary — no cycle:
  // PricingEngineModule (and everything it imports — ScopeModule via
  // forwardRef, CommerceModule) has no dependency back on this module.
  imports: [PricingEngineModule],
  providers: [AiKnowledgeService],
  controllers: [AiKnowledgeController],
  exports: [AiKnowledgeService],
})
export class AiKnowledgeModule {}
