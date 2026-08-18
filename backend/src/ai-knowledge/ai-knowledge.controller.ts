import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AiKnowledgeService } from './ai-knowledge.service';
import { CreateAiKnowledgeEntryDto } from './dto/create-ai-knowledge-entry.dto';
import { UpdateAiKnowledgeEntryDto } from './dto/update-ai-knowledge-entry.dto';

// Staff who actually know customer service and day-to-day operations, not
// a finance-only gate — this is business/CS knowledge, not a pricing
// configuration decision (the real numbers still come from PricingEngineModule's
// own FINANCE_ROLES-gated admin controller; this only teaches the AI to
// read them).
const KNOWLEDGE_ADMIN_ROLES = [Role.CASE_MANAGER, Role.RELATIONSHIP_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...KNOWLEDGE_ADMIN_ROLES)
@Controller('admin/ai-knowledge')
export class AiKnowledgeController {
  constructor(private readonly aiKnowledge: AiKnowledgeService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAiKnowledgeEntryDto) {
    return this.aiKnowledge.create(user, dto);
  }

  @Get()
  list() {
    return this.aiKnowledge.list();
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateAiKnowledgeEntryDto) {
    return this.aiKnowledge.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.aiKnowledge.remove(user, id);
  }
}
