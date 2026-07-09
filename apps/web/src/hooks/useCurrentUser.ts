import { useQuery } from '@tanstack/react-query';
import { fetchCurrentUser } from '@/lib/auth-api';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: fetchCurrentUser,
    retry: false,
  });
}
