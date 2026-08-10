import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const UPLOAD_URL_TTL_SECONDS = 5 * 60; // 5 minutes to complete the PUT
const VIEW_URL_TTL_SECONDS = 15 * 60; // 15 minutes to view/download

/** Prefix used on every dry-run sentinel value this service hands out, so
 * callers (and tests) can recognise "no real object ever existed here"
 * without needing to ask the service whether it's configured. */
const DRY_RUN_PREFIX = 'dry-run://';

/**
 * Section 11.2: "Explicitly do not build ... cloud storage" — this wraps a
 * bought S3-compatible bucket (AWS S3, Cloudflare R2, DO Spaces, or MinIO
 * for local dev; anything speaking the S3 API works via S3_ENDPOINT), never
 * a home-rolled file server. What's ours to build is the *trust boundary*
 * around it: the caller never gets to invent a storageKey — this service
 * issues one, scoped under a case-specific prefix, and every write path
 * verifies the object was actually uploaded before trusting it (see
 * EvidenceService.submitEvidence / DocumentsService.addDocument).
 *
 * Same "dry run without credentials" shape as Paystack/WhatsApp/Anthropic
 * elsewhere in this repo: with no S3_BUCKET configured, this hands back
 * `dry-run://<key>` sentinel URLs instead of talking to a real bucket, so
 * local dev and the e2e suite never need real cloud credentials.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string | null;

  constructor() {
    this.bucket = process.env.S3_BUCKET || null;
    if (!this.bucket) {
      this.logger.warn('S3_BUCKET not set — object storage running in dry-run mode (no real uploads).');
      this.client = null;
      return;
    }
    this.client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  /** Server-generated, case-scoped key — the caller never gets to choose
   * this, which is what makes the existence check in objectExists() mean
   * anything. `fileName`'s extension is kept (for content-type hints on
   * download); nothing else about the client-supplied name is trusted. */
  createKey(prefix: string, fileName?: string): string {
    const ext = fileName?.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    return `${prefix}/${randomUUID()}${ext}`;
  }

  async getUploadUrl(key: string, contentType: string): Promise<{ url: string; expiresInSeconds: number }> {
    if (!this.client || !this.bucket) {
      return { url: `${DRY_RUN_PREFIX}${key}`, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
    }
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return { url, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  /** Never a predictable public URL (Section 11.2) — always short-lived and
   * signed, even in dry-run mode (where it's a non-functional sentinel). */
  async getViewUrl(key: string): Promise<string> {
    if (!this.client || !this.bucket) return `${DRY_RUN_PREFIX}${key}`;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: VIEW_URL_TTL_SECONDS,
    });
  }

  /** In dry-run mode there's no bucket to check against, so this trusts the
   * prefix check callers already did — real verification only starts once
   * a real bucket is configured, same tier as every other integration here. */
  async objectExists(key: string): Promise<boolean> {
    if (!this.client || !this.bucket) return true;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
