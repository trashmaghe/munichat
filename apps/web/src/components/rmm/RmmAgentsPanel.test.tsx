import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RmmAgentsPanel } from '@/components/rmm/RmmAgentsPanel';

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

const agent = {
  agentId: 'a1',
  hostname: 'PC-12',
  siteName: 'Sede',
  clientName: 'Prefeitura',
  platform: 'windows',
  status: 'online',
};

function renderPanel(canRemoteControl: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RmmAgentsPanel canRemoteControl={canRemoteControl} />
    </QueryClientProvider>,
  );
}

describe('RmmAgentsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/remote-control')) {
          return Promise.resolve(
            jsonResponse({
              desktopUrl: 'https://mesh.example.org/control?login=abc',
              terminalUrl: 'https://mesh.example.org/terminal?login=abc',
              fileUrl: 'https://mesh.example.org/files?login=abc',
            }),
          );
        }
        if (url.includes('/rmm/agents')) {
          return Promise.resolve(jsonResponse([agent]));
        }
        return Promise.resolve(jsonResponse({}));
      }),
    );
    vi.stubGlobal('open', vi.fn());
  });

  it('fetches and lists agents once the panel is opened', async () => {
    renderPanel(true);

    expect(screen.queryByText('PC-12')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Monitored devices' }));

    await waitFor(() => {
      expect(screen.getByText('PC-12')).toBeInTheDocument();
    });
  });

  it('hides the remote-control action when canRemoteControl is false', async () => {
    renderPanel(false);

    await userEvent.click(screen.getByRole('button', { name: 'Monitored devices' }));

    await waitFor(() => {
      expect(screen.getByText('PC-12')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: 'Remote control' }),
    ).not.toBeInTheDocument();
  });

  it('opens a confirm dialog and, on confirm, fetches control URLs and opens a new tab', async () => {
    renderPanel(true);

    await userEvent.click(screen.getByRole('button', { name: 'Monitored devices' }));
    await waitFor(() => {
      expect(screen.getByText('PC-12')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Remote control' }));
    expect(
      screen.getByText('Open a remote-control session?'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(window.open).toHaveBeenCalledWith(
        'https://mesh.example.org/control?login=abc',
        '_blank',
        'noopener,noreferrer',
      );
    });
  });
});
