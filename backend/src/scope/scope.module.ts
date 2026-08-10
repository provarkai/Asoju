import { Module } from '@nestjs/common';
import { ScopeService } from './scope.service';
import { ScopeController } from './scope.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  providers: [ScopeService, CaseAccessGuard],
  controllers: [ScopeController],
  exports: [ScopeService],
})
export class ScopeModule {}
