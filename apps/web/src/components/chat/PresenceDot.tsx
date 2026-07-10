import { useChatStore } from '@/stores/useChatStore';
import { cn } from '@/lib/utils';

export function PresenceDot({ userId, className }: { userId: string; className?: string }) {
  const isOnline = useChatStore((state) => state.onlineUserIds.has(userId));

  return (
    <span
      data-slot="presence-dot"
      data-online={isOnline}
      aria-label={isOnline ? 'Online' : 'Offline'}
      className={cn('size-2 shrink-0 rounded-full', isOnline ? 'bg-green-500' : 'bg-muted-foreground/30', className)}
    />
  );
}
