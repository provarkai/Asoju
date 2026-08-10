import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ProvidersService } from './providers.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderStatusDto } from './dto/update-provider-status.dto';
import { CreateCredentialDto } from './dto/create-credential.dto';

// Read access to the directory is broad — see agents.controller.ts for why.
const OPS_ROLES = [
  Role.CASE_MANAGER,
  Role.RELATIONSHIP_MANAGER,
  Role.QUALITY_CONTROL,
  Role.FINANCE,
  Role.COMPLIANCE_RISK,
  Role.ADMIN,
  Role.SUPER_ADMIN,
];

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...OPS_ROLES)
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get()
  list() {
    return this.providersService.listProviders();
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProviderDto) {
    return this.providersService.createProvider(user, dto);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProviderStatusDto,
  ) {
    return this.providersService.updateStatus(user, id, dto.status);
  }

  // -- Provider self-service (Section 12 P1 "advanced provider portal") --

  @Roles(Role.PROVIDER)
  @Get('me')
  getOwnProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.providersService.getOwnProfile(user);
  }

  @Roles(Role.PROVIDER)
  @Post('me/credentials')
  addOwnCredential(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCredentialDto) {
    return this.providersService.addOwnCredential(user, dto);
  }

  // A provider cannot verify their own credential — admin only.
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch('credentials/:credentialId/verify')
  verifyCredential(@CurrentUser() user: AuthenticatedUser, @Param('credentialId') credentialId: string) {
    return this.providersService.verifyCredential(user, credentialId);
  }
}
