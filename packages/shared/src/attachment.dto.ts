import { z } from 'zod';

export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

export const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
] as const;

export const attachmentSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

export type Attachment = z.infer<typeof attachmentSchema>;

export const presignUploadRequestSchema = z.object({
  channelId: z.string(),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(ALLOWED_UPLOAD_MIME_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_UPLOAD_SIZE_BYTES),
});

export type PresignUploadRequest = z.infer<typeof presignUploadRequestSchema>;

export const presignUploadResponseSchema = z.object({
  uploadUrl: z.string(),
  objectKey: z.string(),
  expiresAt: z.string(),
});

export type PresignUploadResponse = z.infer<typeof presignUploadResponseSchema>;

export const pendingAttachmentSchema = z.object({
  objectKey: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

export type PendingAttachment = z.infer<typeof pendingAttachmentSchema>;
