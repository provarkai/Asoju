import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Global()
@Module({
  // EmailModule/AuditModule are @Global() (no explicit import needed);
  // WhatsappSenderService isn't, so WhatsappModule is imported explicitly
  // for the channel fan-out in NotificationsService. No cycle: WhatsappModule
  // only imports AiModule, which has no imports of its own.
  imports: [WhatsappModule],
  providers: [NotificationsService],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
