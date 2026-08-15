import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ProfileService } from './profile.service';
import { CreateBeneficiaryDto } from './dto/beneficiary.dto';
import { CreatePropertyDto } from './dto/property.dto';
import { CreateAssetDto } from './dto/asset.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { CreateVaultDocumentDto } from './dto/vault-document.dto';
import { CreateConciergeFeedbackDto } from './dto/concierge-feedback.dto';
import { RequestUploadUrlDto } from '../storage/dto/request-upload-url.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
@Controller('me')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('preferences')
  getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.getPreferences(user);
  }

  @Patch('preferences')
  updatePreferences(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePreferencesDto) {
    return this.profileService.updatePreferences(user, dto);
  }

  @Get('referral')
  getReferral(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.getReferralSummary(user);
  }

  /** Customer portfolio dashboard (strategic-suggestions pass) — one
   * screen instead of re-deriving the same picture from several endpoints. */
  @Get('portfolio')
  getPortfolio(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.getPortfolio(user);
  }

  @Get('beneficiaries')
  listBeneficiaries(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.listBeneficiaries(user);
  }

  @Post('beneficiaries')
  createBeneficiary(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBeneficiaryDto) {
    return this.profileService.createBeneficiary(user, dto);
  }

  @Delete('beneficiaries/:id')
  deleteBeneficiary(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.profileService.deleteBeneficiary(user, id);
  }

  /** "Who is a Beneficiary" (portal access) — gives the named person their
   * own limited, read-only login instead of being a contact record only
   * the Customer can see. */
  @Post('beneficiaries/:id/invite')
  inviteBeneficiary(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.profileService.inviteBeneficiary(user, id);
  }

  @Get('properties')
  listProperties(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.listProperties(user);
  }

  @Post('properties')
  createProperty(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePropertyDto) {
    return this.profileService.createProperty(user, dto);
  }

  @Delete('properties/:id')
  deleteProperty(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.profileService.deleteProperty(user, id);
  }

  @Get('assets')
  listAssets(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.listAssets(user);
  }

  @Post('assets')
  createAsset(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAssetDto) {
    return this.profileService.createAsset(user, dto);
  }

  @Delete('assets/:id')
  deleteAsset(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.profileService.deleteAsset(user, id);
  }

  @Get('vault')
  getVault(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.getVault(user);
  }

  @Post('vault/upload-url')
  createVaultUploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() dto: RequestUploadUrlDto) {
    return this.profileService.createVaultUploadUrl(user, dto);
  }

  @Post('vault')
  addVaultDocument(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVaultDocumentDto) {
    return this.profileService.addVaultDocument(user, dto);
  }

  @Delete('vault/:id')
  deleteVaultDocument(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.profileService.deleteVaultDocument(user, id);
  }

  @Get('concierge-feedback')
  listConciergeFeedback(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.listConciergeFeedback(user);
  }

  @Post('concierge-feedback')
  recordConciergeFeedback(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateConciergeFeedbackDto) {
    return this.profileService.recordConciergeFeedback(user, dto);
  }
}

/** "Concierge Lab" (/ops) — admin-only, deliberately its own controller
 * rather than a route on ProfileController above, whose whole class is
 * @Roles(Role.CUSTOMER). Same reasoning as AiPublicController being
 * split out in ai.controller.ts. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('admin/concierge-feedback')
export class AdminConciergeFeedbackController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  listAll() {
    return this.profileService.listAllConciergeFeedback();
  }
}
