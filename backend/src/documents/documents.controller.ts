import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';

@UseGuards(JwtAuthGuard, CaseAccessGuard)
@Controller('cases/:caseId/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string) {
    return this.documentsService.listForCase(user, caseId);
  }

  @Post()
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.documentsService.addDocument(user, caseId, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Param('id') id: string,
  ) {
    return this.documentsService.deleteDocument(user, caseId, id);
  }
}
