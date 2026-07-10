import { useQuery } from '@tanstack/react-query';
import { fetchChannelMembers } from '@/lib/chat-api';

export function useChannelMembers(channelId: string) {
  return useQuery({
    queryKey: ['channels', channelId, 'members'],
    queryFn: () => fetchChannelMembers(channelId),
    enabled: Boolean(channelId),
  });
}
