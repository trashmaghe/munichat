import { useQuery } from '@tanstack/react-query';
import { fetchRmmAgents } from '@/lib/rmm-api';

export function useRmmAgents(enabled: boolean) {
  return useQuery({
    queryKey: ['rmm', 'agents'],
    queryFn: fetchRmmAgents,
    enabled,
  });
}
