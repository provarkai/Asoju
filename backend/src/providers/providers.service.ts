import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ProviderStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateProviderDto } from './dto/create-provider.dto';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { assertValidProviderTransition } from './provider-status-machine';

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listProviders() {
    return this.prisma.provider.findMany({
      include: {
        user: { select: { email: true, phone: true, isActive: true } },
        credentials: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createProvider(actor: AuthenticatedUser, dto: CreateProviderDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: Role.PROVIDER,
        providerProfile: {
          create: {
            fullName: dto.fullName,
            serviceCategory: dto.serviceCategory,
            city: dto.city,
            state: dto.state,
            status: ProviderStatus.PENDING,
          },
        },
      },
      include: { providerProfile: true },
    });

    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'provider.onboarded',
      metadata: { providerId: user.providerProfile!.id, userId: user.id },
    });

    return user.providerProfile;
  }

  /** Section 8.2/8.5 lifecycle — never let a provider skip verification. */
  async updateStatus(actor: AuthenticatedUser, providerId: string, status: ProviderStatus) {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new NotFoundException('Provider not found');

    assertValidProviderTransition(provider.status, status);

    const updated = await this.prisma.provider.update({ where: { id: providerId }, data: { status } });

    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'provider.status_changed',
      metadata: { providerId, from: provider.status, to: status },
    });

    return updated;
  }

  /** Section 12 P1 "advanced provider portal" — self-service credentials. */
  async getOwnProfile(user: AuthenticatedUser) {
    const provider = await this.prisma.provider.findUnique({
      where: { userId: user.id },
      include: { credentials: true },
    });
    if (!provider) throw new NotFoundException('No provider profile for this user');
    return provider;
  }

  async addOwnCredential(user: AuthenticatedUser, dto: CreateCredentialDto) {
    const provider = await this.prisma.provider.findUnique({ where: { userId: user.id } });
    if (!provider) throw new NotFoundException('No provider profile for this user');

    const credential = await this.prisma.providerCredential.create({
      data: { providerId: provider.id, ...dto },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'provider_credential.added',
      metadata: { providerId: provider.id, credentialId: credential.id, type: dto.type },
    });

    return credential;
  }

  /** A provider cannot verify their own credential — Non-Negotiable #3 (appropriate human review). */
  async verifyCredential(actor: AuthenticatedUser, credentialId: string) {
    const credential = await this.prisma.providerCredential.findUnique({ where: { id: credentialId } });
    if (!credential) throw new NotFoundException('Credential not found');
    if (credential.verifiedAt) throw new ConflictException('Credential already verified');

    const updated = await this.prisma.providerCredential.update({
      where: { id: credentialId },
      data: { verifiedAt: new Date() },
    });

    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'provider_credential.verified',
      metadata: { credentialId, providerId: credential.providerId },
    });

    return updated;
  }
}
