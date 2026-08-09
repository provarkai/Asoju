import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateUniqueReferralCode } from '../common/referral-code';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await argon2.hash(dto.password);
    const referralCode = await generateUniqueReferralCode(this.prisma);

    // A mistyped/expired referral code shouldn't block onboarding — treat
    // it as "no referral" rather than failing the whole registration.
    let referredByCustomerId: string | undefined;
    if (dto.referralCode) {
      const referrer = await this.prisma.customer.findUnique({
        where: { referralCode: dto.referralCode.toUpperCase() },
      });
      referredByCustomerId = referrer?.id;
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: Role.CUSTOMER,
        countryOfResidence: dto.countryOfResidence,
        preferredChannel: dto.preferredChannel,
        customer: { create: { fullName: dto.fullName, referralCode, referredByCustomerId } },
      },
      include: { customer: true },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'user.registered',
      metadata: { role: user.role, referredByCustomerId },
    });

    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    // MFA enforcement point: staff/admin roles must complete an MFA
    // challenge here before tokens are issued (Section 4 — "MFA optional
    // for customers, mandatory for staff"). Staff accounts are provisioned
    // internally; wire the MFA challenge in when that flow lands.

    await this.audit.record({ actorId: user.id, actorType: 'user', action: 'user.login' });

    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.toPublicUser(user), ...tokens };
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
