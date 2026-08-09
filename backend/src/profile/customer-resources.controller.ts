import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ProfileService } from './profile.service';

const STAFF_TRIAGE_ROLES = [Role.CASE_MANAGER, Role.RELATIONSHIP_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

/**
 * Staff-facing counterpart to /me/* — lets the person triaging a
 * ServiceRequest into a ServiceCase see the requesting customer's saved
 * beneficiaries/properties/assets to link one in (Section 5.1 P1).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_TRIAGE_ROLES)
@Controller('customers/:customerId')
export class CustomerResourcesController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('beneficiaries')
  listBeneficiaries(@Param('customerId') customerId: string) {
    return this.profileService.listBeneficiariesForCustomer(customerId);
  }

  @Get('properties')
  listProperties(@Param('customerId') customerId: string) {
    return this.profileService.listPropertiesForCustomer(customerId);
  }

  @Get('assets')
  listAssets(@Param('customerId') customerId: string) {
    return this.profileService.listAssetsForCustomer(customerId);
  }
}
