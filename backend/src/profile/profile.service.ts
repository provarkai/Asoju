import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateBeneficiaryDto } from './dto/beneficiary.dto';
import { CreatePropertyDto } from './dto/property.dto';
import { CreateAssetDto } from './dto/asset.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

/**
 * Section 5.1 P1 — "saved properties/assets, multiple beneficiaries".
 * These are simple customer-owned resources that later get referenced by
 * a case (ServiceCase.beneficiaryId/propertyId/assetId) so a repeat
 * customer never has to re-describe something ASOJU already knows about.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -- Notification preferences (Section 5.1 P1) --------------------------

  async getPreferences(user: AuthenticatedUser) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { preferredChannel: true },
    });
  }

  async updatePreferences(user: AuthenticatedUser, dto: UpdatePreferencesDto) {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { preferredChannel: dto.preferredChannel },
      select: { preferredChannel: true },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'user.preferences_updated',
      metadata: { preferredChannel: dto.preferredChannel },
    });

    return updated;
  }

  // -- Referrals (Section 12 P1) -----------------------------------------

  async getReferralSummary(user: AuthenticatedUser) {
    const customer = await this.requireCustomer(user.id);
    const referredCount = await this.prisma.customer.count({
      where: { referredByCustomerId: customer.id },
    });
    return { code: customer.referralCode, referredCount };
  }

  // -- Beneficiaries -------------------------------------------------

  async listBeneficiaries(user: AuthenticatedUser) {
    const customer = await this.requireCustomer(user.id);
    return this.prisma.beneficiary.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' } });
  }

  async createBeneficiary(user: AuthenticatedUser, dto: CreateBeneficiaryDto) {
    const customer = await this.requireCustomer(user.id);
    const beneficiary = await this.prisma.beneficiary.create({
      data: { customerId: customer.id, ...dto },
    });
    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'beneficiary.created',
      metadata: { beneficiaryId: beneficiary.id },
    });
    return beneficiary;
  }

  async deleteBeneficiary(user: AuthenticatedUser, id: string) {
    const customer = await this.requireCustomer(user.id);
    const beneficiary = await this.prisma.beneficiary.findUnique({ where: { id } });
    if (!beneficiary) throw new NotFoundException('Beneficiary not found');
    if (beneficiary.customerId !== customer.id) throw new ForbiddenException('Not your beneficiary');

    await this.prisma.beneficiary.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, actorType: 'user', action: 'beneficiary.deleted', metadata: { beneficiaryId: id } });
  }

  // -- Properties ------------------------------------------------------

  async listProperties(user: AuthenticatedUser) {
    const customer = await this.requireCustomer(user.id);
    return this.prisma.property.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' } });
  }

  async createProperty(user: AuthenticatedUser, dto: CreatePropertyDto) {
    const customer = await this.requireCustomer(user.id);
    const property = await this.prisma.property.create({ data: { customerId: customer.id, ...dto } });
    await this.audit.record({ actorId: user.id, actorType: 'user', action: 'property.created', metadata: { propertyId: property.id } });
    return property;
  }

  async deleteProperty(user: AuthenticatedUser, id: string) {
    const customer = await this.requireCustomer(user.id);
    const property = await this.prisma.property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException('Property not found');
    if (property.customerId !== customer.id) throw new ForbiddenException('Not your property');

    await this.prisma.property.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, actorType: 'user', action: 'property.deleted', metadata: { propertyId: id } });
  }

  // -- Assets ------------------------------------------------------------

  async listAssets(user: AuthenticatedUser) {
    const customer = await this.requireCustomer(user.id);
    return this.prisma.asset.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' } });
  }

  async createAsset(user: AuthenticatedUser, dto: CreateAssetDto) {
    const customer = await this.requireCustomer(user.id);
    const asset = await this.prisma.asset.create({ data: { customerId: customer.id, ...dto } });
    await this.audit.record({ actorId: user.id, actorType: 'user', action: 'asset.created', metadata: { assetId: asset.id } });
    return asset;
  }

  async deleteAsset(user: AuthenticatedUser, id: string) {
    const customer = await this.requireCustomer(user.id);
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.customerId !== customer.id) throw new ForbiddenException('Not your asset');

    await this.prisma.asset.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, actorType: 'user', action: 'asset.deleted', metadata: { assetId: id } });
  }

  private async requireCustomer(userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundException('No customer profile for this user');
    return customer;
  }

  // -- Staff-facing reads (Ops Console "convert request" picker) --------
  // No ownership check by design — the caller here is staff triaging a
  // specific customer's request, not the customer themselves. Access is
  // restricted at the controller level to triage-eligible roles.

  async listBeneficiariesForCustomer(customerId: string) {
    return this.prisma.beneficiary.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
  }

  async listPropertiesForCustomer(customerId: string) {
    return this.prisma.property.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
  }

  async listAssetsForCustomer(customerId: string) {
    return this.prisma.asset.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
  }

  /// Section 12 P1 "customer service history" — the one item from that list
  /// that had no dedicated view: a staff member talking to a customer
  /// (or preparing to) needs their whole relationship with ASOJU in one
  /// place, not just the cases currently open in the queue.
  async getCustomerHistory(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { user: { select: { email: true, phone: true } } },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const cases = await this.prisma.serviceCase.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        invoices: { include: { payments: true } },
        rating: { select: { stars: true, comment: true } },
      },
    });

    const caseSummaries = cases.map((c) => {
      const paidAmount = c.invoices
        .flatMap((invoice) => invoice.payments)
        .filter((payment) => payment.status === 'PAID')
        .reduce((sum, payment) => sum + Number(payment.amount), 0);
      return {
        id: c.id,
        caseNumber: c.caseNumber,
        serviceType: c.serviceType,
        status: c.status,
        tier: c.tier,
        createdAt: c.createdAt,
        paidAmount,
        rating: c.rating,
      };
    });

    const completedCases = caseSummaries.filter((c) => c.status === 'COMPLETED' || c.status === 'CLOSED').length;
    const totalPaid = caseSummaries.reduce((sum, c) => sum + c.paidAmount, 0);
    const stars = caseSummaries.map((c) => c.rating?.stars).filter((s): s is number => typeof s === 'number');
    const averageRating = stars.length ? stars.reduce((a, b) => a + b, 0) / stars.length : null;

    return {
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        email: customer.user.email,
        phone: customer.user.phone,
        customerSince: customer.createdAt,
        referralCode: customer.referralCode,
      },
      stats: {
        totalCases: caseSummaries.length,
        completedCases,
        totalPaid,
        averageRating,
      },
      cases: caseSummaries,
    };
  }
}
