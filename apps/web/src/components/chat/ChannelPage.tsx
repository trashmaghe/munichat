import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Message } from '@munichat/shared';
import { useChannels } from '@/hooks/useChannels';
import { useChannelMembers } from '@/hooks/useChannelMembers';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useChatStore } from '@/stores/useChatStore';
import { deleteMessage } from '@/lib/socket';
import { MessageList } from '@/components/chat/MessageList';
import { MessageComposer } from '@/components/chat/MessageComposer';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { PresenceCluster } from '@/components/chat/PresenceCluster';
import { RmmAgentsPanel } from '@/components/rmm/RmmAgentsPanel';

// Matches the server's RMM_ALERT_CHANNEL_NAME default — a deployment that
// renames that channel won't see this entry point line up. Not solved
// generically yet; see apps/api/src/rmm/README.md.
const RMM_CHANNEL_NAME = 'ti';

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
  // GET /rmm/agents only requires channel membership (same audience as the
  // alerts posted here), so the panel itself is shown to any member; only
  // the remote-control action inside it is further gated to channel admins.
  const isRmmChannel = channel?.name === RMM_CHANNEL_NAME;
  const { data: currentUser } = useCurrentUser();
  // Only fetch the member list when it's actually needed for this check —
  // the '' channelId short-circuits useChannelMembers' `enabled` gate.
  const { data: members } = useChannelMembers(isRmmChannel ? channelId : '');
  const isRmmAdmin = Boolean(
    isRmmChannel &&
      members?.some((m) => m.userId === currentUser?.id && m.role === 'ADMIN'),
  );
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
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h1 className="text-sm font-medium">{channel?.displayName ?? 'Channel'}</h1>
        <div className="flex items-center gap-3">
          {isRmmChannel && <RmmAgentsPanel canRemoteControl={isRmmAdmin} />}
          <PresenceCluster channelId={channelId} />
        </div>
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
