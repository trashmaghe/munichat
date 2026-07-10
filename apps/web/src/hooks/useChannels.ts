import { useQuery } from '@tanstack/react-query';
import { fetchChannels } from '@/lib/chat-api';

export function useChannels() {
  return useQuery({
    queryKey: ['channels'],
    queryFn: fetchChannels,
  });
}
