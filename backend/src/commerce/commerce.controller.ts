import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseAccessGuard } from '../common/guards/case-access.guard';
import { WebhookSecretGuard } from '../common/guards/webhook-secret.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CommerceService } from './commerce.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

const STAFF_QUOTE_ROLES = [Role.CASE_MANAGER, Role.FINANCE, Role.ADMIN, Role.SUPER_ADMIN];

@Controller()
export class CommerceController {
  constructor(private readonly commerceService: CommerceService) {}

  @UseGuards(JwtAuthGuard, RolesGuard, CaseAccessGuard)
  @Roles(...STAFF_QUOTE_ROLES)
  @Post('cases/:caseId/quotes')
  createQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: CreateQuoteDto,
  ) {
    return this.commerceService.createQuote(user, caseId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  @Post('quotes/:id/accept')
  acceptQuote(@CurrentUser() user: AuthenticatedUser, @Param('id') quoteId: string) {
    return this.commerceService.acceptQuote(user, quoteId);
  }

  // Called by the payment provider, not a signed-in user — protected by a
  // shared secret rather than JWT (see WebhookSecretGuard).
  @UseGuards(WebhookSecretGuard)
  @Post('payments/webhook')
  handleWebhook(@Body() dto: PaymentWebhookDto) {
    return this.commerceService.handlePaymentWebhook(dto);
  }
}
