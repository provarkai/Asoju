import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileController, AdminConciergeFeedbackController } from './profile.controller';
import { CustomerResourcesController } from './customer-resources.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConciergeModule } from '../concierge/concierge.module';

@Module({
  // For inviteBeneficiary's WhatsApp send (WhatsappSenderService) — same
  // reasoning as NotificationsModule importing WhatsappModule: no cycle,
  // WhatsappModule only imports AiModule. ConciergeModule (ScLedgerService)
  // is for getPortfolio's membership summary — no cycle either, it only
  // imports PaymentsModule.
  imports: [WhatsappModule, ConciergeModule],
  providers: [ProfileService],
  controllers: [ProfileController, CustomerResourcesController, AdminConciergeFeedbackController],
  exports: [ProfileService],
})
export class ProfileModule {}
