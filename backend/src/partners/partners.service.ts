import { Injectable, NotFoundException } from '@nestjs/common';
import { PartnerType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { generateUniquePartnerCode } from '../common/referral-code';

/**
 * Section 12 P2 "partner portal" — an external referral organisation
 * (Section 1's "distribution/partnership channels": diaspora associations,
 * Nigerian businesses, individual agents). Attribution and a read-only
 * dashboard only — deliberately not the P3 "partner ecosystem"
 * (commissions, contracts, self-serve signup).
 */
@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
  ) {}

  // -- Admin management -------------------------------------------------

  async createPartner(actor: AuthenticatedUser, name: string, type: PartnerType) {
    const code = await generateUniquePartnerCode(this.prisma);
    const partner = await this.prisma.partner.create({ data: { name, type, code } });

    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'partner.created',
      metadata: { partnerId: partner.id, name, type, code },
    });

    return partner;
  }

  async listPartners() {
    return this.prisma.partner.findMany({
      include: { _count: { select: { referredCustomers: true, contacts: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPartnerDetail(partnerId: string) {
    const partner = await this.requirePartner(partnerId);
    const referredCustomers = await this.referredCustomerSummaries(partnerId, true);
    return { partner, referredCustomers };
  }

  /** Section 5.7 "Admin Console" — the other self-service gap the README
   * called out alongside staff accounts: a PARTNER-role login always
   * needs a Partner to attach to, so this creates the User (via the same
   * setup-link flow AuthService.adminProvisionAccount uses for staff) and
   * the PartnerContact link in one call rather than two raw Prisma writes. */
  async createPartnerContact(actor: AuthenticatedUser, partnerId: string, email: string) {
    await this.requirePartner(partnerId);

    const { user, devToken } = await this.authService.adminProvisionAccount(actor, email, Role.PARTNER);
    const contact = await this.prisma.partnerContact.create({ data: { partnerId, userId: user.id } });

    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'partner_contact.created',
      metadata: { partnerId, contactId: contact.id, userId: user.id, email },
    });

    return { contact, user, ...(devToken ? { devToken } : {}) };
  }

  // -- Partner self-service ----------------------------------------------

  /** Section 12 P2 — a partner contact's own read-only dashboard: who
   * they've referred and what's happening for each, without financials
   * (the same discipline as the corporate/family Account member view). */
  async getMyDashboard(user: AuthenticatedUser) {
    const contact = await this.prisma.partnerContact.findUnique({
      where: { userId: user.id },
      include: { partner: true },
    });
    if (!contact) throw new NotFoundException('No partner profile for this user');

    const referredCustomers = await this.referredCustomerSummaries(contact.partnerId, false);
    return { partner: contact.partner, referredCustomers };
  }

  private async referredCustomerSummaries(partnerId: string, includeFinancials: boolean) {
    const customers = await this.prisma.customer.findMany({
      where: { referredByPartnerId: partnerId },
      include: {
        user: { select: { email: true } },
        serviceCases: {
          orderBy: { createdAt: 'desc' },
          include: { invoices: { include: { payments: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return customers.map((customer) => ({
      id: customer.id,
      fullName: customer.fullName,
      email: customer.user.email,
      customerSince: customer.createdAt,
      cases: customer.serviceCases.map((serviceCase) => ({
        id: serviceCase.id,
        caseNumber: serviceCase.caseNumber,
        serviceType: serviceCase.serviceType,
        status: serviceCase.status,
        createdAt: serviceCase.createdAt,
        ...(includeFinancials
          ? {
              paidAmount: serviceCase.invoices
                .flatMap((invoice) => invoice.payments)
                .filter((payment) => payment.status === 'PAID')
                .reduce((sum, payment) => sum + Number(payment.amount), 0),
            }
          : {}),
      })),
    }));
  }

  private async requirePartner(partnerId: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundException('Partner not found');
    return partner;
  }
}
