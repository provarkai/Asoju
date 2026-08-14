import { Module } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { EvidenceController } from './evidence.controller';
import { CasesModule } from '../cases/cases.module';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { RiskEngineModule } from '../risk/risk-engine.module';
import { AgentTieringModule } from '../agent-tiering/agent-tiering.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { VoiceTranscriptionModule } from '../voice-transcription/voice-transcription.module';

@Module({
  imports: [CasesModule, RiskEngineModule, AgentTieringModule, WhatsappModule, VoiceTranscriptionModule],
  providers: [EvidenceService, CaseAccessGuard],
  controllers: [EvidenceController],
  exports: [EvidenceService],
})
export class EvidenceModule {}
