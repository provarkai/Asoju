import { Module } from '@nestjs/common';
import { CasesService } from './cases.service';
import { CasesController } from './cases.controller';
import { ServiceCatalogController } from './service-catalog.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';

@Module({
  imports: [IdempotencyModule],
  providers: [CasesService, CaseAccessGuard],
  controllers: [CasesController, ServiceCatalogController],
  exports: [CasesService],
})
export class CasesModule {}
