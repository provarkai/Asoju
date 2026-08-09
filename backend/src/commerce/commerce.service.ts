import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CasesService } from '../cases/cases.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@Injectable()
export class CommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly casesService: CasesService,
  ) {}

  /**
   * Vertical slice 2, step 1: Case -> Quote. Requires the case to already
   * be under review; creating the quote is what moves it to QUOTED
   * (Section 5.2).
   */
  async createQuote(actor: AuthenticatedUser, caseId: string, dto: CreateQuoteDto) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (serviceCase.status !== CaseStatus.UNDER_REVIEW) {
      throw new BadRequestException(`Cannot quote a case in status ${serviceCase.status}`);
    }

    const quote = await this.prisma.quote.create({
      data: {
        caseId,
        amount: dto.amount,
        currency: dto.currency ?? 'NGN',
        breakdown: dto.breakdown as any,
      },
    });

    await this.casesService.transitionCase(actor, caseId, CaseStatus.QUOTED, 'Quote issued');
    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'quote.created',
      metadata: { quoteId: quote.id, amount: dto.amount, currency: quote.currency },
    });

    return quote;
  }

  /**
   * Vertical slice 2, step 2: Quote -> Payment. Customer acceptance
   * creates the Invoice and moves the case to AWAITING_PAYMENT — payment
   * status itself still only ever changes via the provider webhook
   * (Non-Negotiable #4).
   */
  async acceptQuote(actor: AuthenticatedUser, quoteId: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { case: { include: { customer: true } } },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.case.customer.userId !== actor.id) {
      throw new BadRequestException('Not authorised for this quote');
    }
    if (quote.acceptedAt) {
      throw new BadRequestException('Quote already accepted');
    }

    const [, invoice] = await this.prisma.$transaction([
      this.prisma.quote.update({ where: { id: quoteId }, data: { acceptedAt: new Date() } }),
      this.prisma.invoice.create({
        data: { caseId: quote.caseId, quoteId: quote.id, amount: quote.amount, currency: quote.currency },
      }),
    ]);

    await this.casesService.transitionCase(actor, quote.caseId, CaseStatus.AWAITING_PAYMENT, 'Quote accepted');
    await this.audit.record({
      caseId: quote.caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'quote.accepted',
      metadata: { quoteId, invoiceId: invoice.id },
    });

    return invoice;
  }

  /**
   * Vertical slice 2, step 3: Payment -> Scheduled. The ONLY method in the
   * codebase permitted to set a Payment's verified-webhook timestamp
   * (Non-Negotiable #4). Called by WebhookSecretGuard-protected routes only.
   */
  async handlePaymentWebhook(dto: PaymentWebhookDto) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: dto.invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const payment = await this.prisma.payment.upsert({
      where: { providerReference: dto.providerReference },
      update: {
        status: PaymentStatus.PAID,
        providerWebhookVerifiedAt: new Date(),
      },
      create: {
        invoiceId: invoice.id,
        amount: dto.amount,
        currency: dto.currency ?? invoice.currency,
        provider: dto.provider,
        providerReference: dto.providerReference,
        providerWebhookVerifiedAt: new Date(),
        status: PaymentStatus.PAID,
      },
    });

    const serviceCase = await this.prisma.serviceCase.update({
      where: { id: invoice.caseId },
      data: { paymentStatus: PaymentStatus.PAID },
    });

    await this.audit.record({
      caseId: invoice.caseId,
      actorType: 'system',
      action: 'payment.webhook_verified',
      metadata: { paymentId: payment.id, provider: dto.provider, providerReference: dto.providerReference },
    });

    if (serviceCase.status === CaseStatus.AWAITING_PAYMENT) {
      await this.casesService.systemTransitionCase(
        invoice.caseId,
        CaseStatus.SCHEDULED,
        'Payment verified by provider webhook',
      );
    }

    return payment;
  }
}
