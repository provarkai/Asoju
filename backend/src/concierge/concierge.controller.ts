import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConciergeService } from './concierge.service';
import { AssignRmDto } from './dto/assign-rm.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ConciergeController {
  constructor(private readonly conciergeService: ConciergeService) {}

  // -- Customer self-service --------------------------------------------

  @Roles(Role.CUSTOMER)
  @Post('me/subscription')
  subscribe(@CurrentUser() user: AuthenticatedUser) {
    return this.conciergeService.subscribe(user);
  }

  @Roles(Role.CUSTOMER)
  @Get('me/subscription')
  getMySubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.conciergeService.getMySubscription(user);
  }

  @Roles(Role.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @Post('me/subscription/cancel')
  cancelSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.conciergeService.cancelSubscription(user);
  }

  // -- Admin: assigning Relationship Managers -----------------------------

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('concierge/customers')
  listCustomers() {
    return this.conciergeService.listCustomers();
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('concierge/relationship-managers')
  listRelationshipManagers() {
    return this.conciergeService.listRelationshipManagers();
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch('concierge/customers/:customerId/rm')
  assignRm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId') customerId: string,
    @Body() dto: AssignRmDto,
  ) {
    return this.conciergeService.assignRm(user, customerId, dto.rmUserId);
  }

  // -- Relationship Manager: own portfolio --------------------------------

  @Roles(Role.RELATIONSHIP_MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('concierge/portfolio')
  listPortfolio(@CurrentUser() user: AuthenticatedUser) {
    return this.conciergeService.listPortfolio(user);
  }
}
