import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchMessageHistory } from '@/lib/chat-api';

export function useChannelMessages(channelId: string) {
  return useInfiniteQuery({
    queryKey: ['channels', channelId, 'messages'],
    queryFn: ({ pageParam }) => fetchMessageHistory(channelId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(channelId),
  });
}
