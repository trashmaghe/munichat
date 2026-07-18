import { useChannels } from '@/hooks/useChannels';
import { AsphodelMark } from '@/components/brand/AsphodelMark';
import { ChannelListItem } from '@/components/chat/ChannelListItem';
import { InstallPrompt } from '@/components/chat/InstallPrompt';
import { MessageSearch } from '@/components/chat/MessageSearch';
import { UserMenu } from '@/components/chat/UserMenu';

export function ChannelSidebar() {
  const { data: channels, isLoading } = useChannels();

  return (
    <aside data-slot="channel-sidebar" className="flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-3">
        <AsphodelMark className="size-4 text-gold" />
        <p className="text-sm font-semibold tracking-tight">Elyzian</p>
        <span className="ml-auto text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
          Nova Serrana
        </span>
      </div>
      <MessageSearch />
      <nav className="flex-1 overflow-y-auto p-2">
        {isLoading && <p className="px-2 py-1 text-sm text-muted-foreground">Loading channels…</p>}
        {channels?.map((channel) => (
          <ChannelListItem key={channel.id} channel={channel} />
        ))}
      </nav>
      <InstallPrompt />
      <UserMenu />
    </aside>
  );
}
