import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageList } from '@/components/chat/MessageList';

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
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MessageList channelId="channel-1" />
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
});
