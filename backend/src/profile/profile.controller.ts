import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ProfileService } from './profile.service';
import { CreateBeneficiaryDto } from './dto/beneficiary.dto';
import { CreatePropertyDto } from './dto/property.dto';
import { CreateAssetDto } from './dto/asset.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
@Controller('me')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('referral')
  getReferral(@CurrentUser() user: AuthenticatedUser) {
    return this.profileService.getReferralSummary(user);
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
}
