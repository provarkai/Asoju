import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BeneficiaryRelayService } from './beneficiary-relay.service';
import { CreateRelayMessageDto } from './dto/create-relay-message.dto';

/** Platform Expansion PRD §4.4 — deliberately Beneficiary + case-
 * management staff only. No FIELD_AGENT/PROVIDER in this list, which is
 * what actually keeps them off every route below (RolesGuard runs before
 * CaseAccessGuard even loads the case) — that's the "without exposing
 * their PII to the Field Agent" requirement, enforced structurally. */
const RELAY_ROLES = [Role.BENEFICIARY, Role.CASE_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];
const RELAY_STAFF_ROLES = [Role.CASE_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];

@UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
@Roles(...RELAY_ROLES)
@Controller('cases/:caseId/beneficiary-relay')
export class BeneficiaryRelayController {
  constructor(private readonly relayService: BeneficiaryRelayService) {}

  @Get()
  listMessages(@Param('caseId') caseId: string) {
    return this.relayService.listMessages(caseId);
  }

  @Post()
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: CreateRelayMessageDto,
  ) {
    return this.relayService.sendMessage(user, caseId, dto);
  }

  @Roles(...RELAY_STAFF_ROLES)
  @Post(':messageId/acknowledge')
  acknowledgeMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.relayService.acknowledgeMessage(user, caseId, messageId);
  }
}
