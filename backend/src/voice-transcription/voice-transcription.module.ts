import { Module } from '@nestjs/common';
import { VoiceTranscriptionService } from './voice-transcription.service';

@Module({
  providers: [VoiceTranscriptionService],
  exports: [VoiceTranscriptionService],
})
export class VoiceTranscriptionModule {}
