import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { WhatsappController } from './whatsapp.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  providers: [WhatsappService, WhatsappSenderService],
  controllers: [WhatsappController],
  exports: [WhatsappService],
})
export class WhatsappModule {}
