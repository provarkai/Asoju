import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { RequestUploadUrlDto } from '../storage/dto/request-upload-url.dto';
import { CreateVaultDocumentDto } from './dto/create-vault-document.dto';
import { CreateVerifiedAssetDto } from './dto/create-verified-asset.dto';

const VAULT_KEY_PREFIX = 'vault';

/**
 * Section 4.1/4.2 — the customer's document vault, independent of any
 * single case. Distinct from DocumentsService, which is case-scoped —
 * these are the customer's own paperwork (title deeds, CAC certs, IDs,
 * verified PoAs), ready before a case for that document ever exists.
 */
@Injectable()
export class VaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private async requireCustomer(userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw new NotFoundException('No customer profile for this user');
    return customer;
  }

  // -- Documents -----------------------------------------------------------

  /** Same presign-then-verify pattern as DocumentsService.createUploadUrl,
   * just keyed by customerId instead of caseId. */
  async createUploadUrl(user: AuthenticatedUser, dto: RequestUploadUrlDto) {
    const customer = await this.requireCustomer(user.id);
    const key = this.storage.createKey(`${VAULT_KEY_PREFIX}/${customer.id}`, dto.fileName);
    const { url, expiresInSeconds } = await this.storage.getUploadUrl(key, dto.contentType);
    return { storageKey: key, uploadUrl: url, method: 'PUT', expiresInSeconds };
  }

  async listDocuments(user: AuthenticatedUser) {
    const customer = await this.requireCustomer(user.id);
    const documents = await this.prisma.vaultDocument.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      documents.map(async (d) => ({
        ...d,
        downloadUrl: d.storageKey ? await this.storage.getViewUrl(d.storageKey) : null,
      })),
    );
  }

  async addDocument(user: AuthenticatedUser, dto: CreateVaultDocumentDto) {
    const customer = await this.requireCustomer(user.id);

    // Same rule as Document/Evidence: a storageKey only ever came from
    // createUploadUrl() above, never a client-supplied path onto someone
    // else's object (or nothing at all — a vault entry can be metadata-only).
    if (dto.storageKey) {
      if (!dto.storageKey.startsWith(`${VAULT_KEY_PREFIX}/${customer.id}/`)) {
        throw new BadRequestException('storageKey was not issued for this account — request a new upload URL');
      }
      if (!(await this.storage.objectExists(dto.storageKey))) {
        throw new BadRequestException('Uploaded file not found — the upload may not have completed. Request a new upload URL and try again.');
      }
    }

    const document = await this.prisma.vaultDocument.create({
      data: {
        customerId: customer.id,
        name: dto.name,
        category: dto.category,
        notes: dto.notes,
        storageKey: dto.storageKey,
        fileName: dto.fileName,
        fileSize: dto.fileSize,
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'vault_document.added',
      metadata: { documentId: document.id, category: document.category },
    });

    return document;
  }

  async deleteDocument(user: AuthenticatedUser, id: string) {
    const customer = await this.requireCustomer(user.id);
    const document = await this.prisma.vaultDocument.findUnique({ where: { id } });
    if (!document) throw new NotFoundException('Document not found');
    if (document.customerId !== customer.id) throw new ForbiddenException('Not your document');

    await this.prisma.vaultDocument.delete({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'vault_document.deleted',
      metadata: { documentId: id },
    });
  }

  // -- Verified assets (Power of Attorney etc.) -----------------------------

  async listAssets(user: AuthenticatedUser) {
    const customer = await this.requireCustomer(user.id);
    return this.prisma.verifiedAsset.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addAsset(user: AuthenticatedUser, dto: CreateVerifiedAssetDto) {
    const customer = await this.requireCustomer(user.id);
    const asset = await this.prisma.verifiedAsset.create({
      data: { customerId: customer.id, type: dto.type, name: dto.name, notes: dto.notes },
    });
    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'verified_asset.submitted',
      metadata: { assetId: asset.id, type: asset.type },
    });
    return asset;
  }

  /** Staff-only: the one-time verification a submitted asset needs before
   * future cases can reference it (Section 4.2). */
  async verifyAsset(actor: AuthenticatedUser, id: string) {
    const asset = await this.prisma.verifiedAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');

    const updated = await this.prisma.verifiedAsset.update({
      where: { id },
      data: { verified: true, verifiedAt: new Date() },
    });
    await this.audit.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'verified_asset.verified',
      metadata: { assetId: id },
    });
    return updated;
  }
}
