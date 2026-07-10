import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Message } from '@munichat/shared';
import { useChannels } from '@/hooks/useChannels';
import { useChatStore } from '@/stores/useChatStore';
import { deleteMessage } from '@/lib/socket';
import { MessageList } from '@/components/chat/MessageList';
import { MessageComposer } from '@/components/chat/MessageComposer';
import { TypingIndicator } from '@/components/chat/TypingIndicator';

export function ChannelPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const setActiveChannelId = useChatStore((state) => state.setActiveChannelId);

  useEffect(() => {
    setActiveChannelId(channelId ?? null);
    return () => setActiveChannelId(null);
  }, [channelId, setActiveChannelId]);

  if (!channelId) {
    return null;
  }

  // Keying on channelId remounts this subtree on every channel switch, which
  // resets its reply/edit selection state for free instead of needing an
  // effect to reset it (setState-in-effect causes an extra cascading render).
  return <ChannelPageBody key={channelId} channelId={channelId} />;
}

function ChannelPageBody({ channelId }: { channelId: string }) {
  const { data: channels } = useChannels();
  const channel = channels?.find((c) => c.id === channelId);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [editTarget, setEditTarget] = useState<Message | null>(null);

  function handleReply(message: Message) {
    setEditTarget(null);
    setReplyTarget(message);
  }

  function handleEdit(message: Message) {
    setReplyTarget(null);
    setEditTarget(message);
  }

  function handleDelete(messageId: string) {
    void deleteMessage(messageId);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3">
        <h1 className="text-sm font-medium">{channel?.displayName ?? 'Channel'}</h1>
      </header>
      <MessageList
        channelId={channelId}
        onReply={handleReply}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
      <TypingIndicator channelId={channelId} />
      <MessageComposer
        key={editTarget?.id ?? 'composer'}
        channelId={channelId}
        replyTarget={replyTarget}
        editTarget={editTarget}
        onCancelReply={() => setReplyTarget(null)}
        onCancelEdit={() => setEditTarget(null)}
      />
    </div>
  );
}
