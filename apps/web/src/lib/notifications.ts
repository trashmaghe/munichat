import type { Message } from '@elyzian/shared';
import { router } from '@/router';

export interface ShouldNotifyContext {
  message: Pick<Message, 'authorId' | 'channelId'>;
  currentUserId: string | undefined;
  activeChannelId: string | null;
  documentVisibilityState: DocumentVisibilityState;
  permission: NotificationPermission;
  notificationsEnabled: boolean;
}

export function shouldNotify({
  message,
  currentUserId,
  activeChannelId,
  documentVisibilityState,
  permission,
  notificationsEnabled,
}: ShouldNotifyContext): boolean {
  if (!notificationsEnabled || permission !== 'granted') return false;
  if (message.authorId === currentUserId) return false;

  const tabVisibleOnActiveChannel =
    documentVisibilityState === 'visible' && message.channelId === activeChannelId;
  return !tabVisibleOnActiveChannel;
}

export function showMessageNotification(message: Message): void {
  const notification = new Notification(message.author.displayName, {
    body: message.content || 'Sent an attachment',
    tag: `channel-${message.channelId}`,
    icon: '/favicon.svg',
  });
  notification.onclick = () => {
    window.focus();
    void router.navigate(`/channels/${message.channelId}`);
    notification.close();
  };
}
