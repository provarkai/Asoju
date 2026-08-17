import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { VaultService } from './vault.service';
import { RequestUploadUrlDto } from '../storage/dto/request-upload-url.dto';
import { CreateVaultDocumentDto } from './dto/create-vault-document.dto';
import { CreateVerifiedAssetDto } from './dto/create-verified-asset.dto';

const STAFF_VERIFY_ROLES = [Role.CASE_MANAGER, Role.COMPLIANCE_RISK, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Roles(Role.CUSTOMER)
  @Get('me/vault-documents')
  listDocuments(@CurrentUser() user: AuthenticatedUser) {
    return this.vaultService.listDocuments(user);
  }

  @Roles(Role.CUSTOMER)
  @Post('me/vault-documents/upload-url')
  createUploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() dto: RequestUploadUrlDto) {
    return this.vaultService.createUploadUrl(user, dto);
  }

  @Roles(Role.CUSTOMER)
  @Post('me/vault-documents')
  addDocument(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVaultDocumentDto) {
    return this.vaultService.addDocument(user, dto);
  }

  @Roles(Role.CUSTOMER)
  @Delete('me/vault-documents/:id')
  deleteDocument(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.vaultService.deleteDocument(user, id);
  }

  @Roles(Role.CUSTOMER)
  @Get('me/verified-assets')
  listAssets(@CurrentUser() user: AuthenticatedUser) {
    return this.vaultService.listAssets(user);
  }

  @Roles(Role.CUSTOMER)
  @Post('me/verified-assets')
  addAsset(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVerifiedAssetDto) {
    return this.vaultService.addAsset(user, dto);
  }

  @Roles(...STAFF_VERIFY_ROLES)
  @Patch('admin/verified-assets/:id/verify')
  verifyAsset(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.vaultService.verifyAsset(user, id);
  }
}
