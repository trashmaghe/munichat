import { describe, expect, it } from 'vitest';
import { linkPreviewSchema } from './link-preview.dto';

describe('linkPreviewSchema', () => {
  it('accepts a ready preview with all fields present', () => {
    const result = linkPreviewSchema.parse({
      url: 'https://example.com/article',
      title: 'An article',
      description: 'A description',
      imageUrl: 'https://example.com/og.png',
      status: 'READY',
    });
    expect(result.status).toBe('READY');
  });

  it('accepts a failed preview with null fields', () => {
    const result = linkPreviewSchema.parse({
      url: 'https://example.com/unreachable',
      title: null,
      description: null,
      imageUrl: null,
      status: 'FAILED',
    });
    expect(result.title).toBeNull();
  });

  it('rejects an invalid status', () => {
    expect(() =>
      linkPreviewSchema.parse({
        url: 'https://example.com',
        title: null,
        description: null,
        imageUrl: null,
        status: 'PENDING',
      }),
    ).toThrow();
  });
});
