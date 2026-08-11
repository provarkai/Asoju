import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { generateUniqueReferralCode } from '../common/referral-code';
import { generateTotpSecret, otpAuthUrl, verifyTotpCode } from './totp';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const MFA_PENDING_TTL = '5m';
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Admin Console & Platform Admin Architecture v1.0 Section 4 "Admin
 * Roles" / UX/UI Specification Section 42 "Security UX" — "MFA for
 * privileged admin." The roles with the most sensitive reach in this
 * codebase: full platform configuration (ADMIN/SUPER_ADMIN), money
 * movement (FINANCE — refunds, SC adjustments, reconciliation), and
 * compliance/risk data. Case-scoped staff (Case Manager, QC,
 * Relationship Manager) aren't included — real access, but not this
 * tier. */
const MFA_REQUIRED_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.FINANCE, Role.COMPLIANCE_RISK];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await argon2.hash(dto.password);
    const referralCode = await generateUniqueReferralCode(this.prisma);

    // A mistyped/expired referral or partner code shouldn't block
    // onboarding — treat it as "no referral" rather than failing the whole
    // registration.
    let referredByCustomerId: string | undefined;
    if (dto.referralCode) {
      const referrer = await this.prisma.customer.findUnique({
        where: { referralCode: dto.referralCode.toUpperCase() },
      });
      referredByCustomerId = referrer?.id;
    }

    let referredByPartnerId: string | undefined;
    if (dto.partnerCode) {
      const partner = await this.prisma.partner.findUnique({
        where: { code: dto.partnerCode.toUpperCase() },
      });
      if (partner?.status === 'ACTIVE') referredByPartnerId = partner.id;
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: Role.CUSTOMER,
        countryOfResidence: dto.countryOfResidence,
        preferredChannel: dto.preferredChannel,
        customer: { create: { fullName: dto.fullName, referralCode, referredByCustomerId, referredByPartnerId } },
      },
      include: { customer: true },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'user.registered',
      metadata: { role: user.role, referredByCustomerId, referredByPartnerId },
    });

    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.toPublicUser(user), ...tokens };
  }

  /**
   * Security hardening (independent readiness review, P0-06) — if the
   * account has MFA enabled, login no longer returns real tokens directly.
   * It returns a short-lived, single-purpose "mfa pending" token (signed
   * with its own secret, never accepted by JwtStrategy/JwtAuthGuard as a
   * real session — see JWT_MFA_PENDING_SECRET) that only
   * POST /auth/mfa/verify will exchange for real tokens, and only after
   * the correct TOTP code.
   */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    // "Privileged Admin accounts should require MFA" — a privileged user
    // who hasn't enrolled yet gets no real session at all, just a
    // restricted token that can only enroll+confirm MFA (below). This is
    // checked before the existing mfaEnabled branch since it's the same
    // password-verified moment but a materially different response.
    if (MFA_REQUIRED_ROLES.includes(user.role) && !user.mfaEnabled) {
      const enrollmentToken = await this.jwt.signAsync(
        { sub: user.id, purpose: 'mfa_enrollment_required' },
        { secret: this.mfaPendingSecret(), expiresIn: MFA_PENDING_TTL },
      );
      await this.audit.record({ actorId: user.id, actorType: 'user', action: 'user.login_mfa_enrollment_required' });
      return { mfaEnrollmentRequired: true, enrollmentToken };
    }

    if (user.mfaEnabled) {
      const mfaToken = await this.jwt.signAsync(
        { sub: user.id, purpose: 'mfa_pending' },
        { secret: this.mfaPendingSecret(), expiresIn: MFA_PENDING_TTL },
      );
      await this.audit.record({ actorId: user.id, actorType: 'user', action: 'user.login_mfa_challenge' });
      return { mfaRequired: true, mfaToken };
    }

    await this.audit.record({ actorId: user.id, actorType: 'user', action: 'user.login' });

    const tokens = await this.issueTokens(user.id, user.role);
    return { mfaRequired: false, user: this.toPublicUser(user), ...tokens };
  }

  /** Second step of login when MFA is enabled — exchanges a valid
   * mfaToken + correct TOTP code for real session tokens. */
  async verifyMfaLogin(mfaToken: string, code: string) {
    let payload: { sub: string; purpose: string };
    try {
      payload = await this.jwt.verifyAsync(mfaToken, { secret: this.mfaPendingSecret() });
    } catch {
      throw new UnauthorizedException('MFA challenge expired or invalid — please log in again');
    }
    if (payload.purpose !== 'mfa_pending') throw new UnauthorizedException('Invalid MFA challenge');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || !user.mfaEnabled || !user.mfaSecret) {
      throw new UnauthorizedException('Invalid MFA challenge');
    }
    if (!verifyTotpCode(user.mfaSecret, code)) {
      await this.audit.record({ actorId: user.id, actorType: 'user', action: 'user.login_mfa_failed' });
      throw new UnauthorizedException('Incorrect code');
    }

    await this.audit.record({ actorId: user.id, actorType: 'user', action: 'user.login_mfa_verified' });
    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.toPublicUser(user), ...tokens };
  }

  /** Verifies an `enrollmentToken` from the mandatory-MFA login branch
   * above and returns the user it's for — shared by both steps of that
   * flow. Never accepts a `mfa_pending` token (the normal-login-challenge
   * purpose) or vice versa; the two are deliberately non-interchangeable
   * even though they share a signing secret. */
  private async requireMfaEnrollmentUser(enrollmentToken: string) {
    let payload: { sub: string; purpose: string };
    try {
      payload = await this.jwt.verifyAsync(enrollmentToken, { secret: this.mfaPendingSecret() });
    } catch {
      throw new UnauthorizedException('Enrollment session expired or invalid — please log in again');
    }
    if (payload.purpose !== 'mfa_enrollment_required') throw new UnauthorizedException('Invalid enrollment session');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid enrollment session');
    return user;
  }

  /** Step one of mandatory MFA enrollment — same as enrollMfa(), just
   * authorized by the restricted enrollmentToken instead of a real
   * session, since a privileged user without MFA never gets one. */
  async enrollMfaWithToken(enrollmentToken: string) {
    const user = await this.requireMfaEnrollmentUser(enrollmentToken);
    return this.enrollMfa(user.id);
  }

  /** Step two — confirms the code and, unlike self-service confirmMfa()
   * (called by an already-logged-in user from Security Settings), also
   * completes the login: this is the only way a privileged user without
   * MFA ever gets real session tokens. */
  async confirmMfaEnrollmentRequired(enrollmentToken: string, code: string) {
    const user = await this.requireMfaEnrollmentUser(enrollmentToken);
    if (!user.mfaSecret) throw new BadRequestException('Call the enrollment start step first');
    if (!verifyTotpCode(user.mfaSecret, code)) {
      await this.audit.record({ actorId: user.id, actorType: 'user', action: 'user.mfa_enrollment_failed' });
      throw new UnauthorizedException('Incorrect code');
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await this.audit.record({ actorId: user.id, actorType: 'user', action: 'user.mfa_enabled' });
    await this.audit.record({ actorId: user.id, actorType: 'user', action: 'user.login' });

    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.toPublicUser(user), ...tokens };
  }

  /** Starts enrollment: generates a secret and returns the otpauth:// URL
   * for an authenticator app. Not active until confirmMfa() succeeds —
   * storing a pending secret here can't itself enable a login challenge. */
  async enrollMfa(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = generateTotpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecret: secret, mfaEnabled: false } });
    return { secret, otpAuthUrl: otpAuthUrl(user.email ?? user.phone ?? userId, secret) };
  }

  async confirmMfa(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaSecret) throw new BadRequestException('Call POST /auth/mfa/enroll first');
    if (!verifyTotpCode(user.mfaSecret, code)) throw new BadRequestException('Incorrect code');

    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    await this.audit.record({ actorId: userId, actorType: 'user', action: 'user.mfa_enabled' });
    return { mfaEnabled: true };
  }

  async disableMfa(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Incorrect password');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null } });
    await this.audit.record({ actorId: userId, actorType: 'user', action: 'user.mfa_disabled' });
    return { mfaEnabled: false };
  }

  /**
   * Security hardening (P0-06) — never reveals whether an email exists.
   * Without a real mail provider configured (Section 11.2 — email infra
   * is bought/integrated, not built here), this dry-runs: it logs the
   * reset link the same way WhatsappSenderService and PaystackService
   * dry-run without their respective provider credentials, and — for
   * local/dev use only — returns the raw token directly in the response
   * outside production so the flow is actually testable end-to-end.
   */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = randomBytes(32).toString('hex');
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hashToken(token),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      });
      await this.audit.record({ actorId: user.id, actorType: 'user', action: 'user.password_reset_requested' });
      // In-app copy for anyone already logged in elsewhere — not the
      // recovery path itself, since the whole point is they're locked out.
      await this.notifications.notify(
        user.id,
        'Password reset requested',
        'Use the link we sent to reset your password. If you did not request this, you can ignore it.',
      );

      const resetLink = `${this.frontendUrl()}/reset-password?token=${token}`;
      const sendResult = await this.email.sendEmail(
        email,
        'Reset your ASOJU password',
        `<p>Use the link below to reset your password. It expires in 30 minutes.</p>` +
          `<p><a href="${resetLink}">${resetLink}</a></p>` +
          `<p>If you did not request this, you can safely ignore this email.</p>`,
      );
      if (sendResult.dryRun) {
        this.logger.warn(`[dry-run] Password reset requested for ${email} — no email provider configured. Token: ${token}`);
      }

      if (process.env.NODE_ENV !== 'production') {
        return { message: 'If that email exists, a reset link has been sent.', devToken: token };
      }
    }
    return { message: 'If that email exists, a reset link has been sent.' };
  }

  /** Public base URL of the frontend, for building links inside emails —
   * distinct from CORS_ORIGIN (which can list multiple allowed origins
   * for the API's own security check, not the one canonical link target). */
  private frontendUrl(): string {
    return process.env.FRONTEND_URL || 'http://localhost:3000';
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = this.hashToken(token);
    const stored = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired reset link');
    }

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
      // A password reset is a "something may be compromised" moment —
      // every existing session gets revoked, not just this device's.
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({ actorId: stored.userId, actorType: 'user', action: 'user.password_reset_completed' });
  }

  /**
   * "Who is a Beneficiary" (portal access) — the other half of
   * ProfileService.inviteBeneficiary. Same hashed-token/expiry validation
   * as resetPassword, but this creates a brand-new User (Role.BENEFICIARY)
   * and links it to the Beneficiary record rather than updating an
   * existing one — mirrors register()'s email-uniqueness check and
   * auto-login (issueTokens), since claiming an invite *is* this person's
   * account creation.
   */
  async acceptBeneficiaryInvite(token: string, email: string, password: string) {
    const tokenHash = this.hashToken(token);
    const invite = await this.prisma.beneficiaryInvite.findUnique({ where: { tokenHash } });
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired invite link');
    }

    const beneficiary = await this.prisma.beneficiary.findUnique({ where: { id: invite.beneficiaryId } });
    if (!beneficiary) throw new UnauthorizedException('Invalid or expired invite link');
    if (beneficiary.userId) throw new BadRequestException('This beneficiary already has a portal account');

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await argon2.hash(password);
    const user = await this.prisma.user.create({
      data: {
        email,
        phone: beneficiary.phone,
        passwordHash,
        role: Role.BENEFICIARY,
      },
    });
    await this.prisma.$transaction([
      this.prisma.beneficiary.update({ where: { id: beneficiary.id }, data: { userId: user.id } }),
      this.prisma.beneficiaryInvite.update({ where: { id: invite.id }, data: { usedAt: new Date() } }),
    ]);

    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'beneficiary.account_created',
      metadata: { beneficiaryId: beneficiary.id },
    });

    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, phone: true, role: true, mfaEnabled: true },
    });
    return user;
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid refresh token');

    // Rotate: revoke the used refresh token and issue a fresh pair.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(user.id, user.role);
  }

  async logout(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Security hardening (P0-06) "session revocation" — every device, not
   * just the one making this request. Useful after a suspected compromise
   * without waiting for a password reset. */
  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({ actorId: userId, actorType: 'user', action: 'user.logout_all' });
  }

  private async issueTokens(userId: string, role: Role): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, role },
      {
        secret: process.env.JWT_ACCESS_SECRET ?? 'change-me-access-secret',
        expiresIn: process.env.JWT_ACCESS_TTL ?? '15m',
      },
    );

    const refreshToken = createHash('sha256')
      .update(`${userId}:${Date.now()}:${Math.random()}`)
      .digest('hex');
    const refreshTtlMs = this.parseTtlMs(process.env.JWT_REFRESH_TTL ?? '7d');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlMs),
      },
    });

    return { accessToken, refreshToken };
  }

  /** Deliberately a different secret than JWT_ACCESS_SECRET — a leaked or
   * intercepted mfa-pending token must never double as a real session
   * token. Falls back to a value derived from the access secret so this
   * still works without an extra required env var in dev.
   *
   * Uses `||`, not `??`, on purpose: this app's convention for an unset
   * optional secret is `SOME_KEY=""` (see PAYSTACK_SECRET_KEY,
   * OPENROUTER_API_KEY), and `??` only falls back on null/undefined — an
   * explicit empty string would sail through as "configured". That
   * mattered here more than it would elsewhere: @nestjs/jwt's own
   * `JwtService.getSecretKey` falls back with `||` too, so passing it an
   * empty-string secret override doesn't use an empty key, it silently
   * ignores the override and signs with the *module-default* secret —
   * i.e. the real JWT_ACCESS_SECRET, collapsing the mfa-pending token into
   * the same trust domain as a real session token. Caught by
   * privileged-auth.e2e-spec.ts asserting the mfa-pending token is
   * rejected as a bearer token. */
  private mfaPendingSecret(): string {
    return process.env.JWT_MFA_PENDING_SECRET || `${process.env.JWT_ACCESS_SECRET || 'change-me-access-secret'}:mfa-pending`;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseTtlMs(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1], 10);
    const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]!;
    return value * unitMs;
  }

  private toPublicUser(user: { id: string; email: string | null; role: Role }) {
    return { id: user.id, email: user.email, role: user.role };
  }
}
