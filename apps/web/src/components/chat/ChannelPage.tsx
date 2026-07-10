import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useChannels } from '@/hooks/useChannels';
import { useChatStore } from '@/stores/useChatStore';
import { MessageList } from '@/components/chat/MessageList';
import { MessageComposer } from '@/components/chat/MessageComposer';
import { TypingIndicator } from '@/components/chat/TypingIndicator';

export function ChannelPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const { data: channels } = useChannels();
  const setActiveChannelId = useChatStore((state) => state.setActiveChannelId);
  const channel = channels?.find((c) => c.id === channelId);

  useEffect(() => {
    setActiveChannelId(channelId ?? null);
    return () => setActiveChannelId(null);
  }, [channelId, setActiveChannelId]);

  if (!channelId) {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3">
        <h1 className="text-sm font-medium">{channel?.displayName ?? 'Channel'}</h1>
      </header>
      <MessageList channelId={channelId} />
      <TypingIndicator channelId={channelId} />
      <MessageComposer channelId={channelId} />
    </div>
  );
}
