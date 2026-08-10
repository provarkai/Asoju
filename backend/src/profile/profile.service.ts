import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WhatsappSenderService } from '../whatsapp/whatsapp-sender.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateBeneficiaryDto } from './dto/beneficiary.dto';
import { CreatePropertyDto } from './dto/property.dto';
import { CreateAssetDto } from './dto/asset.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { isPiiRestricted, REDACTED_CUSTOMER_NAME } from '../common/pii-restricted-roles';

// "Who is a Beneficiary" — a contact record until invited; a real,
// separately-authenticated portal login after. Same TTL family as
// PASSWORD_RESET_TTL_MS in auth.service.ts, but deliberately much longer:
// this is a "when they get around to it" onboarding action a Customer
// takes on someone else's behalf, not an urgent security recovery flow.
const BENEFICIARY_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Section 5.1 P1 — "saved properties/assets, multiple beneficiaries".
 * These are simple customer-owned resources that later get referenced by
 * a case (ServiceCase.beneficiaryId/propertyId/assetId) so a repeat
 * customer never has to re-describe something ASOJU already knows about.
 */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly whatsappSender: WhatsappSenderService,
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

  /**
   * "Who is a Beneficiary" (portal access) — the Customer invites the
   * person the case is naming so they get their own limited, read-only
   * login (Role.BENEFICIARY) instead of being invisible to the system.
   * Same hashed-token/expiry shape as AuthService's password-reset flow;
   * AuthService.acceptBeneficiaryInvite is the other half. Invalidates any
   * prior unused invite for this beneficiary first — only one active
   * invite at a time, same as re-requesting a password reset supersedes
   * an earlier one.
   */
  async inviteBeneficiary(user: AuthenticatedUser, beneficiaryId: string) {
    const customer = await this.requireCustomer(user.id);
    const beneficiary = await this.prisma.beneficiary.findUnique({ where: { id: beneficiaryId } });
    if (!beneficiary) throw new NotFoundException('Beneficiary not found');
    if (beneficiary.customerId !== customer.id) throw new ForbiddenException('Not your beneficiary');
    if (beneficiary.userId) throw new BadRequestException('This beneficiary already has a portal account');

    await this.prisma.beneficiaryInvite.updateMany({
      where: { beneficiaryId, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(32).toString('hex');
    await this.prisma.beneficiaryInvite.create({
      data: {
        beneficiaryId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + BENEFICIARY_INVITE_TTL_MS),
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'beneficiary.invited',
      metadata: { beneficiaryId },
    });

    const inviteLink = `${this.frontendUrl()}/beneficiary/accept-invite?token=${token}`;
    // Same "dev-only raw link" shape as AuthService.forgotPassword — never
    // exposed in a production API response, only for local/dev testability
    // or when there's genuinely no delivery channel to reach.
    const devInviteLink = process.env.NODE_ENV !== 'production' ? inviteLink : undefined;

    if (beneficiary.phone) {
      const sendResult = await this.whatsappSender.sendMessage(
        beneficiary.phone,
        `${customer.fullName} has invited you to track their ASOJU case(s) with your own login. ` +
          `Set up your account: ${inviteLink} (link expires in 7 days).`,
      );
      if (sendResult.dryRun) {
        this.logger.warn(`[dry-run] Beneficiary invite for ${beneficiaryId} — no WhatsApp provider configured. Link: ${inviteLink}`);
      }
      return { message: 'Invite sent via WhatsApp.', devInviteLink };
    }

    return { message: 'Invite created — no phone on file to send it to.', devInviteLink };
  }

  private frontendUrl(): string {
    return process.env.FRONTEND_URL || 'http://localhost:3000';
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
  async getCustomerHistory(customerId: string, actorRole: Role) {
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

    // Curated case file: this is the same PII this endpoint's callers
    // could otherwise reach through the case queue/detail (name) — with
    // email/phone added on top, so it's the bigger exposure of the two if
    // left ungated. Same restricted-role set, same treatment.
    const restricted = isPiiRestricted(actorRole);

    return {
      customer: {
        id: customer.id,
        fullName: restricted ? REDACTED_CUSTOMER_NAME : customer.fullName,
        email: restricted ? null : customer.user.email,
        phone: restricted ? null : customer.user.phone,
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
