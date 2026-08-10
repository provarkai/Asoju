import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { CustomerResourcesController } from './customer-resources.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  // For inviteBeneficiary's WhatsApp send (WhatsappSenderService) — same
  // reasoning as NotificationsModule importing WhatsappModule: no cycle,
  // WhatsappModule only imports AiModule.
  imports: [WhatsappModule],
  providers: [ProfileService],
  controllers: [ProfileController, CustomerResourcesController],
  exports: [ProfileService],
})
export class ProfileModule {}
