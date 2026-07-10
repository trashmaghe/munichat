import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelSidebar } from '@/components/chat/ChannelSidebar';

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/channels/:channelId', element: <ChannelSidebar /> }], {
    initialEntries: [path],
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('ChannelSidebar', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/channels')) {
          return Promise.resolve(
            jsonResponse([
              { id: 'channel-1', name: 'ti', displayName: 'TI', type: 'DEPARTMENT', createdAt: '2026-07-10T00:00:00.000Z' },
              { id: 'channel-2', name: 'financas', displayName: 'Financas', type: 'DEPARTMENT', createdAt: '2026-07-10T00:00:00.000Z' },
            ]),
          );
        }
        if (url.includes('/users/me')) {
          return Promise.resolve(
            jsonResponse({
              id: 'user-1',
              username: 'jsilva',
              displayName: 'Joao Silva',
              email: null,
              department: 'TI',
              avatarUrl: null,
              isActive: true,
            }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      }),
    );
  });

  it('renders channels from the API and highlights the active one', async () => {
    renderAt('/channels/channel-1');

    await waitFor(() => {
      expect(screen.getByText('TI')).toBeInTheDocument();
      expect(screen.getByText('Financas')).toBeInTheDocument();
    });

    expect(screen.getByText('TI').closest('a')).toHaveAttribute('data-active', 'true');
    expect(screen.getByText('Financas').closest('a')).toHaveAttribute('data-active', 'false');
  });

  it('renders the signed-in user in the footer', async () => {
    renderAt('/channels/channel-1');

    await waitFor(() => {
      expect(screen.getByText('Joao Silva')).toBeInTheDocument();
    });
  });
});
