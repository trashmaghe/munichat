import { describe, expect, it } from 'vitest';
import { messageHistoryResponseSchema, messageSchema, sendMessageRequestSchema } from './message.dto';

const validAuthor = { id: 'u1', username: 'jsilva', displayName: 'Joao Silva', avatarUrl: null };

describe('messageSchema', () => {
  it('accepts a valid message with all nullable fields present', () => {
    const result = messageSchema.parse({
      id: 'm1',
      channelId: 'c1',
      authorId: 'u1',
      content: 'hello',
      type: 'TEXT',
      replyToId: null,
      editedAt: null,
      deletedAt: null,
      createdAt: '2026-07-10T00:00:00.000Z',
      author: validAuthor,
    });
    expect(result.content).toBe('hello');
  });

  it('rejects an invalid message type', () => {
    expect(() =>
      messageSchema.parse({
        id: 'm1',
        channelId: 'c1',
        authorId: 'u1',
        content: 'hello',
        type: 'NOT_A_TYPE',
        replyToId: null,
        editedAt: null,
        deletedAt: null,
        createdAt: '2026-07-10T00:00:00.000Z',
        author: validAuthor,
      }),
    ).toThrow();
  });
});

describe('sendMessageRequestSchema', () => {
  it('trims content and accepts a valid request', () => {
    const result = sendMessageRequestSchema.parse({ channelId: 'c1', content: '  hi  ' });
    expect(result.content).toBe('hi');
  });

  it('rejects empty content', () => {
    expect(() => sendMessageRequestSchema.parse({ channelId: 'c1', content: '   ' })).toThrow();
  });

  it('rejects content over 4000 characters', () => {
    expect(() => sendMessageRequestSchema.parse({ channelId: 'c1', content: 'a'.repeat(4001) })).toThrow();
  });
});

describe('messageHistoryResponseSchema', () => {
  it('accepts a page with a null nextCursor', () => {
    const result = messageHistoryResponseSchema.parse({
      messages: [],
      nextCursor: null,
    });
    expect(result.nextCursor).toBeNull();
  });

  it('accepts a page with a string nextCursor', () => {
    const result = messageHistoryResponseSchema.parse({
      messages: [],
      nextCursor: 'MjAyNi0wNy0xMFQwMDowMDowMC4wMDBaX20x',
    });
    expect(result.nextCursor).not.toBeNull();
  });
});
