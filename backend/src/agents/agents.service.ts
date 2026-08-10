import { ConflictException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateAgentDto } from './dto/create-agent.dto';

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listAgents() {
    return this.prisma.agent.findMany({
      include: { user: { select: { email: true, phone: true, isActive: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAgent(actor: AuthenticatedUser, dto: CreateAgentDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: Role.FIELD_AGENT,
        agentProfile: { create: { fullName: dto.fullName, city: dto.city, state: dto.state } },
      },
      include: { agentProfile: true },
    });

    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'agent.onboarded',
      metadata: { agentId: user.agentProfile!.id, userId: user.id },
    });

    return user.agentProfile;
  }

  async setAgentActive(actor: AuthenticatedUser, agentId: string, isActive: boolean) {
    const agent = await this.prisma.agent.update({ where: { id: agentId }, data: { isActive } });

    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: isActive ? 'agent.reactivated' : 'agent.deactivated',
      metadata: { agentId },
    });

    return agent;
  }
}
