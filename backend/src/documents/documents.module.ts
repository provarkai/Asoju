import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  providers: [DocumentsService, CaseAccessGuard],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
