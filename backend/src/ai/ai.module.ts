import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController, AiAssistantController } from './ai.controller';

@Module({
  providers: [AiService],
  controllers: [AiController, AiAssistantController],
  exports: [AiService],
})
export class AiModule {}
