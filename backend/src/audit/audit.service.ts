import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SearchAuditEventsDto } from './dto/search-audit-events.dto';

export interface RecordAuditEventInput {
  caseId?: string;
  actorId?: string;
  actorType: 'user' | 'ai' | 'system';
  action: string;
  metadata?: Record<string, unknown>;
}

const DEFAULT_SEARCH_TAKE = 100;

/**
 * Append-only audit log (Non-Negotiable #10). This service exposes no
 * update or delete method by design — every other module must go through
 * `record()` and nothing else. Do not add mutation methods here.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput) {
    return this.prisma.auditEvent.create({
      data: {
        caseId: input.caseId,
        actorId: input.actorId,
        actorType: input.actorType,
        action: input.action,
        metadata: input.metadata as any,
      },
    });
  }

  async listForCase(caseId: string) {
    return this.prisma.auditEvent.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Admin Console & Platform Admin Architecture v1.0 Section 26 "Audit
   * Log" — every event this app records is already durable
   * (record() above is called from every material state-changing method
   * across the codebase); this is the first place any of it becomes
   * actually searchable rather than only ever readable per-case. */
  async search(filters: SearchAuditEventsDto) {
    const where: Prisma.AuditEventWhereInput = {
      actorId: filters.actorId,
      actorType: filters.actorType,
      caseId: filters.caseId,
      action: filters.action ? { contains: filters.action, mode: 'insensitive' } : undefined,
      createdAt:
        filters.from || filters.to
          ? { gte: filters.from ? new Date(filters.from) : undefined, lte: filters.to ? new Date(filters.to) : undefined }
          : undefined,
    };

    const take = filters.take ?? DEFAULT_SEARCH_TAKE;
    const skip = filters.skip ?? 0;

    const [events, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        include: {
          actor: { select: { id: true, email: true, role: true } },
          case: { select: { id: true, caseNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return { events, total, take, skip };
  }

  async findById(id: string) {
    const event = await this.prisma.auditEvent.findUnique({
      where: { id },
      include: {
        actor: { select: { id: true, email: true, role: true } },
        case: { select: { id: true, caseNumber: true } },
      },
    });
    if (!event) throw new NotFoundException('Audit event not found');
    return event;
  }
}
