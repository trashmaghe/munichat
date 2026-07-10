import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/stores/useChatStore';
import { useChannelMembers } from '@/hooks/useChannelMembers';

export function TypingIndicator({ channelId }: { channelId: string }) {
  const typingUserIds = useChatStore(
    useShallow((state) => Object.keys(state.typingUsersByChannel[channelId] ?? {})),
  );
  const { data: members } = useChannelMembers(channelId);

  const names = typingUserIds
    .map((userId) => members?.find((member) => member.userId === userId)?.user.displayName)
    .filter((name): name is string => Boolean(name));

  if (names.length === 0) {
    return null;
  }

  const label = names.length === 1 ? `${names[0]} is typing…` : `${names.join(', ')} are typing…`;

  return (
    <p data-slot="typing-indicator" className="px-4 py-1 text-xs text-muted-foreground">
      {label}
    </p>
  );
}
