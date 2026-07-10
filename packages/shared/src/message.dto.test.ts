import { describe, expect, it } from 'vitest';
import { messageHistoryResponseSchema, messageSchema, sendMessageRequestSchema } from './message.dto';

const validAuthor = { id: 'u1', username: 'jsilva', displayName: 'Joao Silva', avatarUrl: null };

const baseMessage = {
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
  attachments: [],
  linkPreview: null,
  replyTo: null,
};

describe('messageSchema', () => {
  it('accepts a valid message with all nullable fields present', () => {
    const result = messageSchema.parse(baseMessage);
    expect(result.content).toBe('hello');
  });

  it('accepts a message with attachments, a link preview, and a reply-to preview', () => {
    const result = messageSchema.parse({
      ...baseMessage,
      attachments: [{ id: 'a1', fileName: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }],
      linkPreview: { url: 'https://example.com', title: 'Example', description: null, imageUrl: null, status: 'READY' },
      replyTo: {
        id: 'm0',
        authorId: 'u2',
        authorDisplayName: 'Maria Ferreira',
        contentPreview: 'earlier message',
        hasAttachment: false,
        deleted: false,
      },
    });
    expect(result.attachments).toHaveLength(1);
    expect(result.linkPreview?.status).toBe('READY');
    expect(result.replyTo?.authorDisplayName).toBe('Maria Ferreira');
  });

  it('rejects an invalid message type', () => {
    expect(() => messageSchema.parse({ ...baseMessage, type: 'NOT_A_TYPE' })).toThrow();
  });
});

describe('sendMessageRequestSchema', () => {
  it('trims content and accepts a valid request', () => {
    const result = sendMessageRequestSchema.parse({ channelId: 'c1', content: '  hi  ' });
    expect(result.content).toBe('hi');
  });

  it('rejects content over 4000 characters', () => {
    expect(() => sendMessageRequestSchema.parse({ channelId: 'c1', content: 'a'.repeat(4001) })).toThrow();
  });

  it('rejects a request with neither content nor attachments', () => {
    expect(() => sendMessageRequestSchema.parse({ channelId: 'c1', content: '   ' })).toThrow();
  });

  it('accepts an attachment-only request with empty content', () => {
    const result = sendMessageRequestSchema.parse({
      channelId: 'c1',
      content: '',
      attachments: [{ objectKey: 'attachments/c1/x-file.png', fileName: 'file.png', mimeType: 'image/png', sizeBytes: 100 }],
    });
    expect(result.attachments).toHaveLength(1);
  });

  it('accepts an optional replyToId', () => {
    const result = sendMessageRequestSchema.parse({ channelId: 'c1', content: 'hi', replyToId: 'm0' });
    expect(result.replyToId).toBe('m0');
  });

  it('rejects more than one attachment', () => {
    const attachment = { objectKey: 'attachments/c1/x-file.png', fileName: 'file.png', mimeType: 'image/png', sizeBytes: 100 };
    expect(() =>
      sendMessageRequestSchema.parse({ channelId: 'c1', content: 'hi', attachments: [attachment, attachment] }),
    ).toThrow();
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
