import { Module } from '@nestjs/common';
import { CommerceService } from './commerce.service';
import { CommerceController } from './commerce.controller';
import { CasesModule } from '../cases/cases.module';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { PaymentsModule } from '../payments/payments.module';
import { ConciergeModule } from '../concierge/concierge.module';

@Module({
  imports: [CasesModule, PaymentsModule, ConciergeModule],
  providers: [CommerceService, CaseAccessGuard],
  controllers: [CommerceController],
  exports: [CommerceService],
})
export class CommerceModule {}
