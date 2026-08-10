import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ProfileService } from './profile.service';

const STAFF_TRIAGE_ROLES = [Role.CASE_MANAGER, Role.RELATIONSHIP_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

// Section 12 P1 "customer service history" — any internal ops role may need
// to pull up a customer's full relationship with ASOJU, same breadth as the
// org-wide case queue (Section 5.3).
const OPS_ROLES = [
  Role.CASE_MANAGER,
  Role.RELATIONSHIP_MANAGER,
  Role.QUALITY_CONTROL,
  Role.FINANCE,
  Role.COMPLIANCE_RISK,
  Role.ADMIN,
  Role.SUPER_ADMIN,
];

/**
 * Staff-facing counterpart to /me/* — lets the person triaging a
 * ServiceRequest into a ServiceCase see the requesting customer's saved
 * beneficiaries/properties/assets to link one in (Section 5.1 P1).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('customers/:customerId')
export class CustomerResourcesController {
  constructor(private readonly profileService: ProfileService) {}

  @Roles(...STAFF_TRIAGE_ROLES)
  @Get('beneficiaries')
  listBeneficiaries(@Param('customerId') customerId: string) {
    return this.profileService.listBeneficiariesForCustomer(customerId);
  }

  @Roles(...STAFF_TRIAGE_ROLES)
  @Get('properties')
  listProperties(@Param('customerId') customerId: string) {
    return this.profileService.listPropertiesForCustomer(customerId);
  }

  @Roles(...STAFF_TRIAGE_ROLES)
  @Get('assets')
  listAssets(@Param('customerId') customerId: string) {
    return this.profileService.listAssetsForCustomer(customerId);
  }

  @Roles(...OPS_ROLES)
  @Get('history')
  getHistory(@CurrentUser() user: AuthenticatedUser, @Param('customerId') customerId: string) {
    return this.profileService.getCustomerHistory(customerId, user.role);
  }
}
