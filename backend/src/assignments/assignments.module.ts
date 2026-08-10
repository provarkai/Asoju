import { Module } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { AssignmentsController } from './assignments.controller';
import { CasesModule } from '../cases/cases.module';
import { CaseAccessGuard } from '../common/guards/case-access.guard';

@Module({
  imports: [CasesModule],
  providers: [AssignmentsService, CaseAccessGuard],
  controllers: [AssignmentsController],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
