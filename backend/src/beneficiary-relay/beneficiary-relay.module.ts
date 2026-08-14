import { Module } from '@nestjs/common';
import { BeneficiaryRelayService } from './beneficiary-relay.service';
import { BeneficiaryRelayController } from './beneficiary-relay.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  providers: [BeneficiaryRelayService, CaseAccessGuard],
  controllers: [BeneficiaryRelayController],
  exports: [BeneficiaryRelayService],
})
export class BeneficiaryRelayModule {}
