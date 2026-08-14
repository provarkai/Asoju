import { apiFetch } from './api';

interface UploadUrlResponse {
  storageKey: string;
  uploadUrl: string;
  method: string;
}

/**
 * Requests a case-scoped presigned upload URL from the backend, then PUTs
 * the file straight to storage — the backend never sees the bytes, only
 * the resulting storageKey (see backend/src/storage). In dry-run mode
 * (no S3 bucket configured on the backend) the upload URL comes back as a
 * `dry-run://` sentinel; the PUT is skipped since there's nothing real to
 * upload to, matching every other "works without credentials" integration
 * in this app.
 *
 * Returns the storageKey to submit with the evidence/document create call.
 */
export async function uploadFile(kind: 'evidence' | 'documents', caseId: string, file: File): Promise<string> {
  const { storageKey, uploadUrl }: UploadUrlResponse = await apiFetch(`/cases/${caseId}/${kind}/upload-url`, {
    method: 'POST',
    body: JSON.stringify({ fileName: file.name, contentType: file.type || 'application/octet-stream' }),
  });

  if (!uploadUrl.startsWith('dry-run://')) {
    // 'x-amz-server-side-encryption' must match what the backend signed
    // into the presigned URL (storage.service.ts#getUploadUrl) or S3
    // rejects the signature — see that file's comment.
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type, 'x-amz-server-side-encryption': 'AES256' },
      body: file,
    });
    if (!res.ok) throw new Error('Upload to storage failed — please try again.');
  }

  return storageKey;
}
