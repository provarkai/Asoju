import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentVisibility, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateDocumentDto } from './dto/create-document.dto';
import { filterDocumentsForFieldActor } from './document-visibility';

const FIELD_ROLES: Role[] = [Role.FIELD_AGENT, Role.PROVIDER];

/**
 * Section 12 P1 — "document vault". Anyone who already has case access
 * (enforced by CaseAccessGuard at the controller) can add a document —
 * customer, assigned agent/provider, or attached staff. This is
 * deliberately not evidence: it's paperwork (title docs, ID copies,
 * receipts) the customer or a professional wants on file against the
 * case, not part of the inspection's chain of custody (Section 8.4).
 *
 * Security hardening (independent readiness review, P0-04): CaseAccessGuard
 * only proves a field actor holds *some* assignment on the case — it says
 * nothing about which documents that assignment actually needs. This
 * service is where that narrowing happens: customer and staff always see
 * everything on their own case; a FIELD_AGENT/PROVIDER sees a document
 * only if it's unrestricted (ALL) or restricted to their own assignment.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listForCase(actor: AuthenticatedUser, caseId: string) {
    const documents = await this.prisma.document.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' } });
    if (!FIELD_ROLES.includes(actor.role)) return documents; // customer, staff, admin: unrestricted

    const ownAssignmentIds = new Set(
      (
        await this.prisma.assignment.findMany({
          where: { caseId, OR: [{ agent: { userId: actor.id } }, { provider: { userId: actor.id } }] },
          select: { id: true },
        })
      ).map((a) => a.id),
    );

    return filterDocumentsForFieldActor(documents, ownAssignmentIds);
  }

  async addDocument(actor: AuthenticatedUser, caseId: string, dto: CreateDocumentDto) {
    const visibility = dto.visibility ?? DocumentVisibility.ALL;
    if (visibility === DocumentVisibility.ASSIGNEE) {
      if (!dto.restrictedToAssignmentId) {
        throw new BadRequestException('restrictedToAssignmentId is required when visibility is ASSIGNEE');
      }
      const assignment = await this.prisma.assignment.findUnique({ where: { id: dto.restrictedToAssignmentId } });
      if (!assignment || assignment.caseId !== caseId) {
        throw new BadRequestException('restrictedToAssignmentId must be an assignment on this case');
      }
    }

    const document = await this.prisma.document.create({
      data: {
        caseId,
        label: dto.label,
        storageKey: dto.storageKey,
        uploadedById: actor.id,
        visibility,
        restrictedToAssignmentId: visibility === DocumentVisibility.ASSIGNEE ? dto.restrictedToAssignmentId : null,
      },
    });

    await this.audit.record({
      caseId,
      actorId: actor.id,
      actorType: 'user',
      action: 'document.added',
      metadata: { documentId: document.id, label: dto.label, visibility },
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
