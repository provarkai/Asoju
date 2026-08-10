import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ScopeService } from './scope.service';
import { CreateScopeDto } from './dto/create-scope.dto';

const SCOPE_STAFF_ROLES = [Role.CASE_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
@Controller('cases/:caseId/scope')
export class ScopeController {
  constructor(private readonly scopeService: ScopeService) {}

  /** No @Roles — anyone with case access (customer, staff, assigned
   * field actor) can see what was actually agreed to. */
  @Get()
  getLatest(@Param('caseId') caseId: string) {
    return this.scopeService.getLatest(caseId);
  }

  @Get('versions')
  listVersions(@Param('caseId') caseId: string) {
    return this.scopeService.listVersions(caseId);
  }

  @Roles(...SCOPE_STAFF_ROLES)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: CreateScopeDto,
  ) {
    return this.scopeService.createOrRevise(user, caseId, dto);
  }

  @Roles(Role.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @Post('confirm')
  confirm(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string) {
    return this.scopeService.confirm(user, caseId);
  }
}
