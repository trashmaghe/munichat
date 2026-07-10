import { describe, expect, it } from 'vitest';
import {
  presenceSyncPayloadSchema,
  presenceUpdatePayloadSchema,
  typingBroadcastSchema,
  typingClientPayloadSchema,
} from './socket-events.dto';

describe('typingClientPayloadSchema', () => {
  it('accepts a valid payload', () => {
    const result = typingClientPayloadSchema.parse({ channelId: 'c1' });
    expect(result.channelId).toBe('c1');
  });

  it('rejects a missing channelId', () => {
    expect(() => typingClientPayloadSchema.parse({})).toThrow();
  });
});

describe('typingBroadcastSchema', () => {
  it('accepts a valid broadcast payload', () => {
    const result = typingBroadcastSchema.parse({ channelId: 'c1', userId: 'u1' });
    expect(result.userId).toBe('u1');
  });

  it('rejects a missing userId', () => {
    expect(() => typingBroadcastSchema.parse({ channelId: 'c1' })).toThrow();
  });
});

describe('presenceSyncPayloadSchema', () => {
  it('accepts a valid payload with an empty list', () => {
    const result = presenceSyncPayloadSchema.parse({ onlineUserIds: [] });
    expect(result.onlineUserIds).toEqual([]);
  });

  it('rejects a non-array onlineUserIds', () => {
    expect(() => presenceSyncPayloadSchema.parse({ onlineUserIds: 'u1' })).toThrow();
  });
});

describe('presenceUpdatePayloadSchema', () => {
  it('accepts a valid payload', () => {
    const result = presenceUpdatePayloadSchema.parse({ userId: 'u1', online: true });
    expect(result.online).toBe(true);
  });

  it('rejects a missing online field', () => {
    expect(() => presenceUpdatePayloadSchema.parse({ userId: 'u1' })).toThrow();
  });
});
