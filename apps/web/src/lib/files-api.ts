import { presignUploadResponseSchema, type PresignUploadResponse } from '@munichat/shared';
import { apiFetch } from '@/lib/api-client';

export async function presignUpload(
  channelId: string,
  file: File,
): Promise<PresignUploadResponse> {
  const res = await apiFetch<unknown>('/files/presign', {
    method: 'POST',
    body: JSON.stringify({
      channelId,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    }),
  });
  return presignUploadResponseSchema.parse(res);
}

export async function uploadToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Upload failed with status ${res.status}`);
  }
}
