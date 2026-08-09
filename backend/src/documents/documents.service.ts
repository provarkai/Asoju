import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateDocumentDto } from './dto/create-document.dto';

/**
 * Section 12 P1 — "document vault". Anyone who already has case access
 * (enforced by CaseAccessGuard at the controller) can add or see a
 * document — customer, assigned agent/provider, or attached staff. This
 * is deliberately not evidence: it's paperwork (title docs, ID copies,
 * receipts) the customer or a professional wants on file against the
 * case, not part of the inspection's chain of custody (Section 8.4).
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listForCase(caseId: string) {
    return this.prisma.document.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' } });
  }

  async addDocument(actor: AuthenticatedUser, caseId: string, dto: CreateDocumentDto) {
    const document = await this.prisma.document.create({
      data: { caseId, label: dto.label, storageKey: dto.storageKey, uploadedById: actor.id },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'document.added',
      metadata: { documentId: document.id, label: dto.label },
    });

    return document;
  }

  async deleteDocument(actor: AuthenticatedUser, caseId: string, documentId: string) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.caseId !== caseId) throw new NotFoundException('Document not found on this case');

    const isOwner = document.uploadedById === actor.id;
    const isAdmin = actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN;
    if (!isOwner && !isAdmin) throw new ForbiddenException('Only the uploader or an admin can remove this document');

    await this.prisma.document.delete({ where: { id: documentId } });
    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'document.deleted',
      metadata: { documentId },
    });
  }
}
