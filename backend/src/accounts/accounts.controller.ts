import { Body, Controller, Get, Param, Post, Delete, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { AddMemberDto } from './dto/add-member.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  // -- Customer self-service ------------------------------------------------

  @Roles(Role.CUSTOMER)
  @Get('me/account')
  getMyAccount(@CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.getMyAccount(user);
  }

  // -- Admin management -------------------------------------------------

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('accounts')
  createAccount(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAccountDto) {
    return this.accountsService.createAccount(user, dto.name, dto.type);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('accounts')
  listAccounts() {
    return this.accountsService.listAccounts();
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('accounts/:accountId')
  getAccountDetail(@Param('accountId') accountId: string) {
    return this.accountsService.getAccountDetail(accountId);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('accounts/:accountId/members')
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId') accountId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.accountsService.addMember(user, accountId, dto.customerId);
  }

  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete('accounts/:accountId/members/:customerId')
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId') accountId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.accountsService.removeMember(user, accountId, customerId);
  }
}
