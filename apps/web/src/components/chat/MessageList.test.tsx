import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocketEvent } from '@elyzian/shared';
import { createMockSocket, getMockSocket, setMockSocket } from '@/test/socket-mock';

vi.mock('socket.io-client', () => ({
  io: () => getMockSocket(),
}));

async function loadMessageList() {
  vi.resetModules();
  setMockSocket(createMockSocket());
  const { MessageList } = await import('@/components/chat/MessageList');
  return MessageList;
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

const author = { id: 'user-1', username: 'jsilva', displayName: 'Joao Silva', avatarUrl: null };

function buildMessage(id: string, content: string, createdAt: string) {
  return {
    id,
    channelId: 'channel-1',
    authorId: 'user-1',
    content,
    type: 'TEXT',
    replyToId: null,
    editedAt: null,
    deletedAt: null,
    createdAt,
    author,
    attachments: [],
    linkPreview: null,
    ticketRef: null,
    replyTo: null,
  };
}

describe('MessageList', () => {
  beforeEach(() => {
    const firstPage = { messages: [buildMessage('m2', 'second', '2026-07-10T00:00:02.000Z')], nextCursor: 'cursor-1' };
    const secondPage = { messages: [buildMessage('m1', 'first', '2026-07-10T00:00:01.000Z')], nextCursor: null };

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('cursor=cursor-1')) {
          return Promise.resolve(jsonResponse(secondPage));
        }
        if (url.includes('/messages')) {
          return Promise.resolve(jsonResponse(firstPage));
        }
        if (url.includes('/users/me')) {
          return Promise.resolve(
            jsonResponse({
              id: 'user-1',
              username: 'jsilva',
              displayName: 'Joao Silva',
              email: null,
              department: null,
              avatarUrl: null,
              isActive: true,
            }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      }),
    );
  });

  it('renders the first page ascending, then prepends an earlier page on demand', async () => {
    const MessageList = await loadMessageList();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MessageList
          channelId="channel-1"
          onReply={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('second')).toBeInTheDocument());
    expect(screen.queryByText('first')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /load earlier messages/i }));

    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());

    const rendered = screen.getAllByText(/^(first|second)$/).map((el) => el.textContent);
    expect(rendered).toEqual(['first', 'second']);
  });

  it('marks the channel read at the newest loaded message once the list renders', async () => {
    const MessageList = await loadMessageList();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(
      ['channels'],
      [{ id: 'channel-1', name: 'ti', displayName: 'TI', type: 'DEPARTMENT', createdAt: '2026-07-10T00:00:00.000Z', unreadCount: 2 }],
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MessageList
          channelId="channel-1"
          onReply={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('second')).toBeInTheDocument());

    const socket = getMockSocket();
    await waitFor(() =>
      expect(socket.emit).toHaveBeenCalledWith(
        SocketEvent.CHANNEL_READ,
        { channelId: 'channel-1', messageId: 'm2' },
        expect.any(Function),
      ),
    );

    const channels = queryClient.getQueryData<{ id: string; unreadCount: number }[]>(['channels']);
    expect(channels?.find((c) => c.id === 'channel-1')?.unreadCount).toBe(0);
  });
});
