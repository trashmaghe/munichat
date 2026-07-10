import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { logout } from '@/lib/auth-api';
import { Button } from '@/components/ui/button';

export function UserMenu() {
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['currentUser'] }),
  });

  return (
    <div data-slot="user-menu" className="flex items-center justify-between gap-2 border-t p-3">
      <span className="truncate text-sm text-muted-foreground">{currentUser?.displayName}</span>
      <Button variant="outline" size="sm" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
        Sign out
      </Button>
    </div>
  );
}
