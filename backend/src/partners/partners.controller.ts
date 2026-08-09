import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PartnersService } from './partners.service';
import { CreatePartnerDto } from './dto/create-partner.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  // -- Partner self-service ------------------------------------------------

  @Roles(Role.PARTNER)
  @Get('partner/dashboard')
  getMyDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.partnersService.getMyDashboard(user);
  }

  // -- Admin management ---------------------------------------------------

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('partners')
  createPartner(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePartnerDto) {
    return this.partnersService.createPartner(user, dto.name, dto.type);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('partners')
  listPartners() {
    return this.partnersService.listPartners();
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('partners/:partnerId')
  getPartnerDetail(@Param('partnerId') partnerId: string) {
    return this.partnersService.getPartnerDetail(partnerId);
  }
}
