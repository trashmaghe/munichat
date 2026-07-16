import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InstallPrompt } from '@/components/chat/InstallPrompt';

function dispatchBeforeInstallPrompt() {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(event);
  return event;
}

describe('InstallPrompt', () => {
  it('renders nothing until beforeinstallprompt fires', () => {
    render(<InstallPrompt />);
    expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument();
  });

  it('shows an install button after beforeinstallprompt fires and calls prompt() on click', async () => {
    render(<InstallPrompt />);
    const event = dispatchBeforeInstallPrompt();

    const button = await screen.findByRole('button', { name: /install/i });
    const user = userEvent.setup();
    await user.click(button);

    expect(event.prompt).toHaveBeenCalled();
  });
});
