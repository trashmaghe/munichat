import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchMessageSearch } from '@/lib/chat-api';

export function useMessageSearch(q: string, channelId?: string) {
  return useInfiniteQuery({
    queryKey: ['messages', 'search', q, channelId],
    queryFn: ({ pageParam }) => fetchMessageSearch(q, channelId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: q.trim().length > 0,
  });
}
