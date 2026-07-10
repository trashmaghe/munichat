import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '@/stores/useChatStore';

function resetStore() {
  useChatStore.setState({
    activeChannelId: null,
    typingUsersByChannel: {},
    onlineUserIds: new Set(),
  });
}

describe('useChatStore', () => {
  beforeEach(resetStore);

  it('sets and clears the active channel', () => {
    useChatStore.getState().setActiveChannelId('channel-1');
    expect(useChatStore.getState().activeChannelId).toBe('channel-1');

    useChatStore.getState().setActiveChannelId(null);
    expect(useChatStore.getState().activeChannelId).toBeNull();
  });

  it('adds and removes typing users per channel', () => {
    useChatStore.getState().addTyping('channel-1', 'user-1', 1000);
    expect(useChatStore.getState().typingUsersByChannel['channel-1']).toEqual({ 'user-1': 1000 });

    useChatStore.getState().removeTyping('channel-1', 'user-1');
    expect(useChatStore.getState().typingUsersByChannel['channel-1']).toEqual({});
  });

  it('prunes only expired typing entries', () => {
    useChatStore.getState().addTyping('channel-1', 'user-1', 100);
    useChatStore.getState().addTyping('channel-1', 'user-2', 5000);

    useChatStore.getState().pruneExpiredTyping(1000);

    expect(useChatStore.getState().typingUsersByChannel['channel-1']).toEqual({ 'user-2': 5000 });
  });

  it('tracks online users via setOnlineUsers and setUserOnline', () => {
    useChatStore.getState().setOnlineUsers(['user-1', 'user-2']);
    expect(useChatStore.getState().onlineUserIds).toEqual(new Set(['user-1', 'user-2']));

    useChatStore.getState().setUserOnline('user-3', true);
    expect(useChatStore.getState().onlineUserIds.has('user-3')).toBe(true);

    useChatStore.getState().setUserOnline('user-1', false);
    expect(useChatStore.getState().onlineUserIds.has('user-1')).toBe(false);
  });
});
