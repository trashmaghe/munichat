import { describe, expect, it } from 'vitest';
import { shouldNotify } from '@/lib/notifications';

const baseMessage = { authorId: 'user-2', channelId: 'channel-1' };

const baseContext = {
  message: baseMessage,
  currentUserId: 'user-1',
  activeChannelId: 'channel-1',
  documentVisibilityState: 'visible' as DocumentVisibilityState,
  permission: 'granted' as NotificationPermission,
  notificationsEnabled: true,
};

describe('shouldNotify', () => {
  it('does not notify when the tab is visible and showing the message\'s own channel', () => {
    expect(shouldNotify(baseContext)).toBe(false);
  });

  it('notifies when the tab is hidden, even on the active channel', () => {
    expect(shouldNotify({ ...baseContext, documentVisibilityState: 'hidden' })).toBe(true);
  });

  it('notifies when the tab is visible but a different channel is active', () => {
    expect(shouldNotify({ ...baseContext, activeChannelId: 'channel-2' })).toBe(true);
  });

  it('does not notify for the current user\'s own message', () => {
    expect(
      shouldNotify({
        ...baseContext,
        documentVisibilityState: 'hidden',
        message: { ...baseMessage, authorId: 'user-1' },
      }),
    ).toBe(false);
  });

  it('does not notify when permission is not granted', () => {
    expect(
      shouldNotify({ ...baseContext, documentVisibilityState: 'hidden', permission: 'denied' }),
    ).toBe(false);
  });

  it('does not notify when the user has disabled notifications', () => {
    expect(
      shouldNotify({ ...baseContext, documentVisibilityState: 'hidden', notificationsEnabled: false }),
    ).toBe(false);
  });
});
