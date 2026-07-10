import { describe, expect, it } from 'vitest';
import { channelMemberSummarySchema, channelSummarySchema } from './channel.dto';

describe('channelSummarySchema', () => {
  it('accepts a valid channel summary', () => {
    const result = channelSummarySchema.parse({
      id: 'c1',
      name: 'ti',
      displayName: 'TI',
      type: 'DEPARTMENT',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
    expect(result.name).toBe('ti');
  });

  it('rejects an invalid channel type', () => {
    expect(() =>
      channelSummarySchema.parse({
        id: 'c1',
        name: 'ti',
        displayName: 'TI',
        type: 'NOT_A_TYPE',
        createdAt: '2026-07-10T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('channelMemberSummarySchema', () => {
  it('accepts a valid channel member summary with embedded user', () => {
    const result = channelMemberSummarySchema.parse({
      userId: 'u1',
      channelId: 'c1',
      role: 'MEMBER',
      joinedAt: '2026-07-10T00:00:00.000Z',
      user: { id: 'u1', username: 'jsilva', displayName: 'Joao Silva', avatarUrl: null },
    });
    expect(result.user.username).toBe('jsilva');
  });

  it('rejects an invalid role', () => {
    expect(() =>
      channelMemberSummarySchema.parse({
        userId: 'u1',
        channelId: 'c1',
        role: 'OWNER',
        joinedAt: '2026-07-10T00:00:00.000Z',
        user: { id: 'u1', username: 'jsilva', displayName: 'Joao Silva', avatarUrl: null },
      }),
    ).toThrow();
  });
});
