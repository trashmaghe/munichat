import type { UserSummary } from '@elyzian/shared';
import { cn } from '@/lib/utils';

function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export function UserAvatar({
  user,
  className,
}: {
  user: Pick<UserSummary, 'displayName' | 'avatarUrl'>;
  className?: string;
}) {
  return (
    <span
      data-slot="user-avatar"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-[11px] font-medium text-sidebar-primary-foreground ring-1 ring-foreground/5',
        className,
      )}
    >
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" className="size-full rounded-full object-cover" />
      ) : (
        getInitials(user.displayName)
      )}
    </span>
  );
}
