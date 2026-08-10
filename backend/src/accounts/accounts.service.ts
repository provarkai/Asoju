import { Injectable, NotFoundException } from '@nestjs/common';
import { Account, AccountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

/**
 * Section 12 P2 "corporate accounts" / "family management dashboard" — a
 * read-only umbrella grouping several Customer records (a household or a
 * company) so members can see who-else-is-in-the-group and what's being
 * handled for each. Deliberately not a billing-consolidation or shared-
 * access engine: full case detail still requires actually owning or
 * collaborating on the case (Non-Negotiable #6 is untouched by this
 * module) — an account only widens what a *summary* view can show.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -- Admin management -----------------------------------------------------

  async createAccount(actor: AuthenticatedUser, name: string, type?: AccountType) {
    const account = await this.prisma.account.create({
      data: { name, type: type ?? AccountType.FAMILY },
    });
    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'account.created',
      metadata: { accountId: account.id, name: account.name, type: account.type },
    });
    return account;
  }

  async listAccounts() {
    return this.prisma.account.findMany({
      include: { _count: { select: { customers: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAccountDetail(accountId: string) {
    const account = await this.requireAccount(accountId);
    const members = await this.membersWithCaseSummaries(accountId, true);
    return { account, members };
  }

  async addMember(actor: AuthenticatedUser, accountId: string, customerId: string) {
    await this.requireAccount(accountId);
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const updated = await this.prisma.customer.update({ where: { id: customerId }, data: { accountId } });
    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'account.member_added',
      metadata: { accountId, customerId },
    });
    return updated;
  }

  async removeMember(actor: AuthenticatedUser, accountId: string, customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.accountId !== accountId) {
      throw new NotFoundException('Customer is not a member of this account');
    }

    const updated = await this.prisma.customer.update({ where: { id: customerId }, data: { accountId: null } });
    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'account.member_removed',
      metadata: { accountId, customerId },
    });
    return updated;
  }

  // -- Customer self-service --------------------------------------------

  /** A member's own view of their account — same shape as the staff view,
   * minus payment amounts, which stay staff-only. */
  async getMyAccount(user: AuthenticatedUser) {
    const customer = await this.prisma.customer.findUnique({ where: { userId: user.id } });
    if (!customer) throw new NotFoundException('No customer profile for this user');
    if (!customer.accountId) return null;

    const account = await this.requireAccount(customer.accountId);
    const members = await this.membersWithCaseSummaries(customer.accountId, false);
    return { account, members };
  }

  private async membersWithCaseSummaries(accountId: string, includeFinancials: boolean) {
    const customers = await this.prisma.customer.findMany({
      where: { accountId },
      include: {
        user: { select: { email: true } },
        serviceCases: {
          orderBy: { createdAt: 'desc' },
          include: { invoices: { include: { payments: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return customers.map((customer) => ({
      id: customer.id,
      fullName: customer.fullName,
      email: customer.user.email,
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

  private async requireAccount(accountId: string): Promise<Account> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }
}
