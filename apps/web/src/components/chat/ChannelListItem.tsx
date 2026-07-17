import { Link, useParams } from 'react-router-dom';
import type { ChannelSummary } from '@munichat/shared';
import { cn } from '@/lib/utils';

export function ChannelListItem({ channel }: { channel: ChannelSummary }) {
  const { channelId } = useParams();
  const isActive = channelId === channel.id;

  return (
    <Link
      to={`/channels/${channel.id}`}
      data-slot="channel-list-item"
      data-active={isActive}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted',
        isActive && 'bg-muted font-medium',
      )}
    >
      <span className="truncate">{channel.displayName}</span>
      {channel.unreadCount > 0 && (
        <span
          data-slot="unread-badge"
          className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground"
        >
          {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
        </span>
      )}
    </Link>
  );
}
