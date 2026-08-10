import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { WhatsappController } from './whatsapp.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  providers: [WhatsappService, WhatsappSenderService],
  controllers: [WhatsappController],
  // WhatsappSenderService is also exported (not just WhatsappService) so
  // NotificationsModule can send real outbound messages for the channel
  // fan-out described on WhatsappSenderService/NotificationsService,
  // without needing the AI-conversation machinery WhatsappService wraps.
  exports: [WhatsappService, WhatsappSenderService],
})
export class WhatsappModule {}
