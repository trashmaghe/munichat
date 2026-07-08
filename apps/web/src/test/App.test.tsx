import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '@/pages/HomePage';

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ status: 'ok', uptime: 12.3, timestamp: new Date().toISOString() }),
      }),
    );
  });

  it('renders live API status once the health check resolves', async () => {
    renderWithQueryClient(<HomePage />);

    expect(screen.getByText(/checking api status/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/api status: ok/i)).toBeInTheDocument();
    });
  });
});
