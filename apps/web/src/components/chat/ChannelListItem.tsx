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
        'flex items-center rounded-lg px-2 py-1.5 text-sm hover:bg-muted',
        isActive && 'bg-muted font-medium',
      )}
    >
      <span className="truncate">{channel.displayName}</span>
    </Link>
  );
}
