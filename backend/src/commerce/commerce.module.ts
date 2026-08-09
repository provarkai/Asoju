import { Module } from '@nestjs/common';
import { CommerceService } from './commerce.service';
import { CommerceController } from './commerce.controller';
import { CasesModule } from '../cases/cases.module';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  imports: [CasesModule],
  providers: [CommerceService, CaseAccessGuard],
  controllers: [CommerceController],
  exports: [CommerceService],
})
export class CommerceModule {}
