import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { logout } from '@/lib/auth-api';
import { useUIStore } from '@/stores/useUIStore';
import { Button } from '@/components/ui/button';

export function UserMenu() {
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const notificationsEnabled = useUIStore((state) => state.notificationsEnabled);
  const setNotificationsEnabled = useUIStore((state) => state.setNotificationsEnabled);
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['currentUser'] }),
  });

  async function handleToggleNotifications() {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      return;
    }
    const permission =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
    if (permission === 'granted') {
      setNotificationsEnabled(true);
    }
  }

  return (
    <div data-slot="user-menu" className="flex items-center justify-between gap-2 border-t p-3">
      <span className="truncate text-sm text-muted-foreground">{currentUser?.displayName}</span>
      <div className="flex items-center gap-1">
        {typeof Notification !== 'undefined' && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void handleToggleNotifications()}
            aria-label={notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}
            title={notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}
          >
            {notificationsEnabled ? <Bell /> : <BellOff />}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
