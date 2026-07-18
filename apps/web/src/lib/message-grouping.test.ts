import { describe, expect, it } from 'vitest';
import type { Message } from '@elyzian/shared';
import { computeMessageGrouping } from '@/lib/message-grouping';

const author = { id: 'user-1', username: 'jsilva', displayName: 'Joao Silva', avatarUrl: null };
const otherAuthor = { id: 'user-2', username: 'rsouza', displayName: 'Renata Souza', avatarUrl: null };

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    channelId: 'channel-1',
    authorId: 'user-1',
    content: 'hello',
    type: 'TEXT',
    replyToId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: '2026-07-10T09:00:00.000Z',
    author,
    attachments: [],
    linkPreview: null,
    ticketRef: null,
    replyTo: null,
    ...overrides,
  };
}

describe('computeMessageGrouping', () => {
  it('never groups the first message', () => {
    const result = computeMessageGrouping([buildMessage()]);
    expect(result).toEqual([false]);
  });

  it('groups consecutive messages from the same author within the time window', () => {
    const messages = [
      buildMessage({ id: 'm1', createdAt: '2026-07-10T09:00:00.000Z' }),
      buildMessage({ id: 'm2', createdAt: '2026-07-10T09:01:00.000Z' }),
    ];
    expect(computeMessageGrouping(messages)).toEqual([false, true]);
  });

  it('does not group messages from different authors', () => {
    const messages = [
      buildMessage({ id: 'm1', authorId: 'user-1', author, createdAt: '2026-07-10T09:00:00.000Z' }),
      buildMessage({ id: 'm2', authorId: 'user-2', author: otherAuthor, createdAt: '2026-07-10T09:00:30.000Z' }),
    ];
    expect(computeMessageGrouping(messages)).toEqual([false, false]);
  });

  it('does not group same-author messages more than 5 minutes apart', () => {
    const messages = [
      buildMessage({ id: 'm1', createdAt: '2026-07-10T09:00:00.000Z' }),
      buildMessage({ id: 'm2', createdAt: '2026-07-10T09:06:00.000Z' }),
    ];
    expect(computeMessageGrouping(messages)).toEqual([false, false]);
  });

  it('breaks grouping around a SYSTEM message', () => {
    const messages = [
      buildMessage({ id: 'm1', createdAt: '2026-07-10T09:00:00.000Z' }),
      buildMessage({ id: 'm2', type: 'SYSTEM', createdAt: '2026-07-10T09:00:10.000Z' }),
      buildMessage({ id: 'm3', createdAt: '2026-07-10T09:00:20.000Z' }),
    ];
    expect(computeMessageGrouping(messages)).toEqual([false, false, false]);
  });
});
