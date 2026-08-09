import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordAuditEventInput {
  caseId?: string;
  actorId?: string;
  actorType: 'user' | 'ai' | 'system';
  action: string;
  metadata?: Record<string, unknown>;
}

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
}
