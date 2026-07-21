import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '@/pages/LoginPage';

describe('LoginPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('logs in successfully and shows no error message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          user: {
            id: 'user-1',
            username: 'jsilva',
            displayName: 'Joao Silva',
            email: null,
            department: null,
            avatarUrl: null,
            isActive: true,
          },
        }),
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/username/i), 'jsilva');
    await user.type(screen.getByLabelText(/password/i), 'devpassword123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/login'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    expect(screen.queryByText(/invalid username or password/i)).not.toBeInTheDocument();
  });

  it('seeds the currentUser cache synchronously from the login response, not via a background refetch', async () => {
    const responseUser = {
      id: 'user-1',
      username: 'jsilva',
      displayName: 'Joao Silva',
      email: null,
      department: null,
      avatarUrl: null,
      isActive: true,
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ user: responseUser }),
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/username/i), 'jsilva');
    await user.type(screen.getByLabelText(/password/i), 'devpassword123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Regression test: previously this relied on invalidateQueries() to
    // trigger a background /users/me refetch, which never happens for a
    // query nothing is observing yet (ProtectedRoute, which mounts only
    // after navigate('/')) - so the cache stayed empty/stale right after a
    // successful login until that race resolved. It must be populated the
    // instant the login mutation succeeds, with no further fetch calls.
    await waitFor(() => {
      expect(queryClient.getQueryData(['currentUser'])).toEqual(responseUser);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shows an inline error on a 401 response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/username/i), 'jsilva');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid username or password/i)).toBeInTheDocument();
    });
  });
});
