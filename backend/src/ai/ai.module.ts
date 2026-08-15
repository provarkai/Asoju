import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController, AiAssistantController, AiPublicController } from './ai.controller';

@Module({
  providers: [AiService],
  controllers: [AiController, AiAssistantController, AiPublicController],
  exports: [AiService],
})
export class AiModule {}
