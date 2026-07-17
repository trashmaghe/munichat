import { describe, expect, it } from 'vitest';
import {
  MAX_UPLOAD_SIZE_BYTES,
  attachmentSchema,
  presignUploadRequestSchema,
  presignUploadResponseSchema,
} from './attachment.dto';

describe('attachmentSchema', () => {
  it('accepts a valid attachment', () => {
    const result = attachmentSchema.parse({
      id: 'a1',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(result.fileName).toBe('report.pdf');
  });

  it('rejects a negative sizeBytes', () => {
    expect(() =>
      attachmentSchema.parse({ id: 'a1', fileName: 'x', mimeType: 'text/plain', sizeBytes: -1 }),
    ).toThrow();
  });
});

describe('presignUploadRequestSchema', () => {
  it('accepts a valid request', () => {
    const result = presignUploadRequestSchema.parse({
      channelId: 'c1',
      fileName: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 2048,
    });
    expect(result.mimeType).toBe('image/png');
  });

  it('accepts audio and video types (inline media + voice messages)', () => {
    for (const mimeType of ['video/mp4', 'audio/mpeg', 'audio/webm', 'audio/mp4']) {
      expect(
        presignUploadRequestSchema.parse({
          channelId: 'c1',
          fileName: `clip.${mimeType.split('/')[1]}`,
          mimeType,
          sizeBytes: 4096,
        }).mimeType,
      ).toBe(mimeType);
    }
  });

  it('rejects a disallowed mime type', () => {
    expect(() =>
      presignUploadRequestSchema.parse({
        channelId: 'c1',
        fileName: 'script.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 100,
      }),
    ).toThrow();
  });

  it('rejects a size over the cap', () => {
    expect(() =>
      presignUploadRequestSchema.parse({
        channelId: 'c1',
        fileName: 'huge.zip',
        mimeType: 'application/zip',
        sizeBytes: MAX_UPLOAD_SIZE_BYTES + 1,
      }),
    ).toThrow();
  });
});

describe('presignUploadResponseSchema', () => {
  it('accepts a valid response', () => {
    const result = presignUploadResponseSchema.parse({
      uploadUrl: 'https://minio.local/bucket/key?signature=abc',
      objectKey: 'attachments/c1/uuid-file.png',
      expiresAt: '2026-07-10T00:05:00.000Z',
    });
    expect(result.objectKey).toContain('attachments/c1');
  });
});
