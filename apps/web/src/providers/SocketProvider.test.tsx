import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocketEvent } from '@munichat/shared';
import { createMockSocket, getMockSocket, setMockSocket } from '@/test/socket-mock';

vi.mock('socket.io-client', () => ({
  io: () => getMockSocket(),
}));

// getSocket() caches its socket in module scope, so each test resets the
// module registry and re-imports fresh to pick up that test's own mock.
async function loadSocketProvider() {
  vi.resetModules();
  setMockSocket(createMockSocket());
  const { SocketProvider } = await import('@/providers/SocketProvider');
  const { useChatStore } = await import('@/stores/useChatStore');
  return { SocketProvider, useChatStore };
}

describe('SocketProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('connects on mount, appends message:new to the cache, syncs presence, and disconnects on unmount', async () => {
    const { SocketProvider, useChatStore } = await loadSocketProvider();
    const queryClient = new QueryClient();
    queryClient.setQueryData(['channels', 'channel-1', 'messages'], {
      pages: [{ messages: [], nextCursor: null }],
      pageParams: [undefined],
    });

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <SocketProvider>
          <div>chat</div>
        </SocketProvider>
      </QueryClientProvider>,
    );

    const socket = getMockSocket();
    expect(socket.connect).toHaveBeenCalledTimes(1);

    const message = {
      id: 'm1',
      channelId: 'channel-1',
      authorId: 'user-1',
      content: 'hi',
      type: 'TEXT',
      replyToId: null,
      editedAt: null,
      deletedAt: null,
      createdAt: '2026-07-10T00:00:00.000Z',
      author: { id: 'user-1', username: 'jsilva', displayName: 'Joao Silva', avatarUrl: null },
    };
    socket.trigger(SocketEvent.MESSAGE_NEW, message);

    const cached = queryClient.getQueryData<{ pages: { messages: unknown[] }[] }>([
      'channels',
      'channel-1',
      'messages',
    ]);
    expect(cached?.pages[0].messages).toEqual([message]);

    socket.trigger(SocketEvent.PRESENCE_SYNC, { onlineUserIds: ['user-1'] });
    expect(useChatStore.getState().onlineUserIds.has('user-1')).toBe(true);

    socket.trigger(SocketEvent.PRESENCE_UPDATE, { userId: 'user-1', online: false });
    expect(useChatStore.getState().onlineUserIds.has('user-1')).toBe(false);

    unmount();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('replaces a message in the cache when message:updated is received (edit/delete/link-preview-ready)', async () => {
    const { SocketProvider } = await loadSocketProvider();
    const queryClient = new QueryClient();
    const original = {
      id: 'm1',
      channelId: 'channel-1',
      authorId: 'user-1',
      content: 'original',
      type: 'TEXT',
      replyToId: null,
      editedAt: null,
      deletedAt: null,
      createdAt: '2026-07-10T00:00:00.000Z',
      author: { id: 'user-1', username: 'jsilva', displayName: 'Joao Silva', avatarUrl: null },
    };
    queryClient.setQueryData(['channels', 'channel-1', 'messages'], {
      pages: [{ messages: [original], nextCursor: null }],
      pageParams: [undefined],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SocketProvider>
          <div>chat</div>
        </SocketProvider>
      </QueryClientProvider>,
    );

    const updated = { ...original, content: 'edited', editedAt: '2026-07-10T00:01:00.000Z' };
    getMockSocket().trigger(SocketEvent.MESSAGE_UPDATED, updated);

    const cached = queryClient.getQueryData<{ pages: { messages: unknown[] }[] }>([
      'channels',
      'channel-1',
      'messages',
    ]);
    expect(cached?.pages[0].messages).toEqual([updated]);
  });

  it('clears the currentUser cache when the socket reports a connect_error', async () => {
    const { SocketProvider } = await loadSocketProvider();
    const queryClient = new QueryClient();
    queryClient.setQueryData(['currentUser'], { id: 'user-1' });

    render(
      <QueryClientProvider client={queryClient}>
        <SocketProvider>
          <div>chat</div>
        </SocketProvider>
      </QueryClientProvider>,
    );

    getMockSocket().trigger('connect_error');

    expect(queryClient.getQueryData(['currentUser'])).toBeNull();
  });
});
