import { describe, expect, it } from 'vitest';
import { messageSearchQuerySchema, messageSearchResponseSchema } from './message-search.dto';

describe('messageSearchQuerySchema', () => {
  it('trims the query and accepts an optional channelId/cursor', () => {
    const result = messageSearchQuerySchema.parse({ q: '  crachá  ', channelId: 'c1', cursor: 'abc' });
    expect(result.q).toBe('crachá');
    expect(result.channelId).toBe('c1');
  });

  it('accepts a query with no channelId or cursor', () => {
    const result = messageSearchQuerySchema.parse({ q: 'crachá' });
    expect(result.channelId).toBeUndefined();
    expect(result.cursor).toBeUndefined();
  });

  it('rejects an empty query', () => {
    expect(() => messageSearchQuerySchema.parse({ q: '   ' })).toThrow();
  });
});

describe('messageSearchResponseSchema', () => {
  it('accepts a page with a null nextCursor', () => {
    const result = messageSearchResponseSchema.parse({ messages: [], nextCursor: null });
    expect(result.nextCursor).toBeNull();
  });
});
