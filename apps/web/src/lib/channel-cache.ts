import type { QueryClient } from '@tanstack/react-query';
import type { ChannelSummary } from '@munichat/shared';

function patchUnreadCount(
  queryClient: QueryClient,
  channelId: string,
  next: (current: number) => number,
): void {
  queryClient.setQueryData<ChannelSummary[]>(['channels'], (channels) => {
    if (!channels) {
      return channels;
    }
    return channels.map((channel) =>
      channel.id === channelId
        ? { ...channel, unreadCount: next(channel.unreadCount) }
        : channel,
    );
  });
}

export function markChannelReadInCache(queryClient: QueryClient, channelId: string): void {
  patchUnreadCount(queryClient, channelId, () => 0);
}

export function incrementUnreadCountInCache(queryClient: QueryClient, channelId: string): void {
  patchUnreadCount(queryClient, channelId, (count) => count + 1);
}
