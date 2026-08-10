import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentVisibility, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateDocumentDto } from './dto/create-document.dto';
import { RequestUploadUrlDto } from '../storage/dto/request-upload-url.dto';
import { filterDocumentsForFieldActor } from './document-visibility';

const FIELD_ROLES: Role[] = [Role.FIELD_AGENT, Role.PROVIDER];
const DOCUMENT_KEY_PREFIX = 'documents';

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
    private readonly storage: StorageService,
  ) {}

  /** Same presign-then-verify pattern as EvidenceService.createUploadUrl —
   * see the comment on addDocument()'s storageKey check below for why. */
  async createUploadUrl(caseId: string, dto: RequestUploadUrlDto) {
    const key = this.storage.createKey(`${DOCUMENT_KEY_PREFIX}/${caseId}`, dto.fileName);
    const { url, expiresInSeconds } = await this.storage.getUploadUrl(key, dto.contentType);
    return { storageKey: key, uploadUrl: url, method: 'PUT', expiresInSeconds };
  }

  async listForCase(actor: AuthenticatedUser, caseId: string) {
    const documents = await this.prisma.document.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' } });
    const visible = FIELD_ROLES.includes(actor.role)
      ? filterDocumentsForFieldActor(
          documents,
          new Set(
            (
              await this.prisma.assignment.findMany({
                where: { caseId, OR: [{ agent: { userId: actor.id } }, { provider: { userId: actor.id } }] },
                select: { id: true },
              })
            ).map((a) => a.id),
          ),
        )
      : documents; // customer, staff, admin: unrestricted

    return Promise.all(visible.map(async (doc) => ({ ...doc, viewUrl: await this.storage.getViewUrl(doc.storageKey) })));
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

    // Same rule as evidence: a storageKey only ever came from
    // createUploadUrl() above, never a client-supplied path onto someone
    // else's object (or nothing at all).
    if (!dto.storageKey.startsWith(`${DOCUMENT_KEY_PREFIX}/${caseId}/`)) {
      throw new BadRequestException('storageKey was not issued for this case — request a new upload URL');
    }
    if (!(await this.storage.objectExists(dto.storageKey))) {
      throw new BadRequestException('Uploaded file not found — the upload may not have completed. Request a new upload URL and try again.');
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
