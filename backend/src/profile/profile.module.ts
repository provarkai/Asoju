import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { CustomerResourcesController } from './customer-resources.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConciergeModule } from '../concierge/concierge.module';
import { FxModule } from '../fx/fx.module';

@Module({
  // For inviteBeneficiary's WhatsApp send (WhatsappSenderService) — same
  // reasoning as NotificationsModule importing WhatsappModule: no cycle,
  // WhatsappModule only imports AiModule. ConciergeModule (ScLedgerService)
  // is for getPortfolio's membership summary — no cycle either, it only
  // imports PaymentsModule. FxModule — GET /me/fx-rate, no cycle.
  imports: [WhatsappModule, ConciergeModule, FxModule],
  providers: [ProfileService],
  controllers: [ProfileController, CustomerResourcesController],
  exports: [ProfileService],
})
export class ProfileModule {}
