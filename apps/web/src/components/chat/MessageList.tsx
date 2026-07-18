import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Message } from '@elyzian/shared';
import { useChannelMessages } from '@/hooks/useChannelMessages';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { computeMessageGrouping } from '@/lib/message-grouping';
import { MessageItem } from '@/components/chat/MessageItem';
import { Button } from '@/components/ui/button';
import { markChannelRead } from '@/lib/socket';
import { markChannelReadInCache } from '@/lib/channel-cache';

const NEAR_BOTTOM_THRESHOLD_PX = 100;

// Reactions have no backend yet (Phase 7 backlog) — these two demo pills, pinned
// to the newest couple of messages, exist only to make the new UI visible.
function getDemoReactions(index: number, total: number): { emoji: string; count: number }[] | undefined {
  if (index === total - 1) return [{ emoji: '👍', count: 1 }, { emoji: '🎉', count: 1 }];
  if (index === total - 3) return [{ emoji: '👀', count: 2 }];
  return undefined;
}

export function MessageList({
  channelId,
  onReply,
  onEdit,
  onDelete,
}: {
  channelId: string;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onDelete: (messageId: string) => void;
}) {
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useChannelMessages(channelId);
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);
  const lastReadMessageIdRef = useRef<string | null>(null);

  const messages = data ? [...data.pages].reverse().flatMap((page) => page.messages) : [];
  const groupingFlags = computeMessageGrouping(messages);

  useEffect(() => {
    const container = containerRef.current;
    if (container && wasNearBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length]);

  // Mark the channel read whenever the newest loaded message changes while
  // the user is actually looking at the bottom of the list — not just
  // because the channel is open (they may be scrolled up into history).
  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (
      !latest ||
      !wasNearBottomRef.current ||
      latest.id === lastReadMessageIdRef.current
    ) {
      return;
    }
    lastReadMessageIdRef.current = latest.id;
    markChannelReadInCache(queryClient, channelId);
    void markChannelRead(channelId, latest.id);
    // Reruns on messages.length (new message appended/loaded), not on every
    // `messages` array identity change (a fresh array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, messages.length, queryClient]);

  function handleScroll() {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    wasNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD_PX;
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      data-slot="message-list"
      className="flex flex-1 flex-col overflow-y-auto"
    >
      {hasNextPage && (
        <div className="flex justify-center py-2">
          <Button variant="ghost" size="sm" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}
          </Button>
        </div>
      )}
      {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading messages…</p>}
      {messages.map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          isOwn={message.authorId === currentUser?.id}
          isGrouped={groupingFlags[index] ?? false}
          reactions={getDemoReactions(index, messages.length)}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
