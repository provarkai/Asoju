import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { RecordEarningDto } from './dto/record-earning.dto';
import { RecordPayoutDto } from './dto/record-payout.dto';

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Wallet — a real earnings ledger, inherited from FieldForce's ledger.ts
// ═══════════════════════════════════════════════════════════════════════════════
// Confirmed the gap first: Payout existed with recipientType/agentId/amount
// fields but zero call sites anywhere in this codebase, and there was no
// WalletAccount/WalletEntry at all. Deliberately simpler than FieldForce's
// pending/qcCleared/available three-bucket balance — ASOJU has no automatic
// case→fee formula to credit earnings against (nothing here ties a case's
// price to an agent's cut), so crediting a case's earnings is a single
// explicit Finance action, gated on the case having actually passed QC,
// rather than an automatic pending balance that clears itself over time.

const QC_PASSED_STATUSES: CaseStatus[] = [CaseStatus.APPROVED, CaseStatus.COMPLETED, CaseStatus.CLOSED];

@Injectable()
export class AgentWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async getOrCreateWallet(agentId: string) {
    const existing = await this.prisma.walletAccount.findUnique({ where: { agentId } });
    if (existing) return existing;
    return this.prisma.walletAccount.create({ data: { agentId } });
  }

  /** Finance records what an agent earned on a case — only once the case
   * has actually passed QC (APPROVED/COMPLETED/CLOSED), so earnings can
   * never be credited for work that hasn't been reviewed yet. */
  async recordEarning(actor: AuthenticatedUser, caseId: string, dto: RecordEarningDto) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { id: caseId } });
    if (!serviceCase) throw new NotFoundException('Case not found');
    if (!QC_PASSED_STATUSES.includes(serviceCase.status)) {
      throw new BadRequestException(
        `Cannot record agent earnings for a case in status ${serviceCase.status} — the case must have passed QC first`,
      );
    }

    const assignment = await this.prisma.assignment.findFirst({
      where: { caseId, role: 'FIELD_AGENT' },
      orderBy: { createdAt: 'desc' },
    });
    if (!assignment?.agentId) {
      throw new BadRequestException('This case has no field agent assignment to credit earnings against');
    }

    const wallet = await this.getOrCreateWallet(assignment.agentId);

    const [entry] = await this.prisma.$transaction([
      this.prisma.walletEntry.create({
        data: {
          agentId: assignment.agentId,
          walletAccountId: wallet.id,
          type: 'EARNING',
          amount: dto.amount,
          caseId,
          description: dto.description,
          actorId: actor.id,
        },
      }),
      this.prisma.walletAccount.update({
        where: { id: wallet.id },
        data: {
          availableBalance: { increment: dto.amount },
          totalEarnings: { increment: dto.amount },
        },
      }),
    ]);

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'case.agent_earnings_recorded',
      metadata: { agentId: assignment.agentId, amount: dto.amount, walletEntryId: entry.id },
    });

    return entry;
  }

  /** Finance records that an agent was paid out — cannot exceed what's
   * actually available in their wallet. There is no payment-gateway
   * integration for outbound agent transfers; this is Finance recording
   * that a payout already happened (same "record, not a trigger" honesty
   * as DirectCost), not a money-movement call. */
  async recordPayout(actor: AuthenticatedUser, agentId: string, dto: RecordPayoutDto) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');

    const wallet = await this.prisma.walletAccount.findUnique({ where: { agentId } });
    const available = wallet ? Number(wallet.availableBalance) : 0;
    if (dto.amount > available) {
      throw new BadRequestException(
        `Payout of ${dto.amount} exceeds available balance of ${available} — nothing was recorded`,
      );
    }

    const [payout] = await this.prisma.$transaction([
      this.prisma.payout.create({
        data: {
          recipientType: 'FIELD_AGENT',
          agentId,
          amount: dto.amount,
          status: 'PAID',
          note: dto.note,
        },
      }),
      this.prisma.walletAccount.update({
        where: { id: wallet!.id },
        data: {
          availableBalance: { decrement: dto.amount },
          totalPaid: { increment: dto.amount },
        },
      }),
    ]);

    await this.prisma.walletEntry.create({
      data: {
        agentId,
        walletAccountId: wallet!.id,
        type: 'PAYOUT_DEBIT',
        amount: dto.amount,
        payoutId: payout.id,
        description: dto.note,
        actorId: actor.id,
      },
    });

    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'agent.payout_recorded',
      metadata: { agentId, amount: dto.amount, payoutId: payout.id },
    });

    return payout;
  }

  async getWallet(actor: AuthenticatedUser, agentId: string) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');

    const isOps = actor.role === Role.FINANCE || actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN;
    const isOwnWallet = agent.userId === actor.id;
    if (!isOps && !isOwnWallet) {
      throw new ForbiddenException('Not authorised to view this agent’s wallet');
    }

    const wallet = await this.prisma.walletAccount.findUnique({ where: { agentId } });
    if (!wallet) {
      return { agentId, availableBalance: 0, totalEarnings: 0, totalPaid: 0, entries: [] };
    }

    const entries = await this.prisma.walletEntry.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return { ...wallet, entries };
  }
}
