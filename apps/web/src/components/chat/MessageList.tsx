import { useEffect, useRef } from 'react';
import { useChannelMessages } from '@/hooks/useChannelMessages';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { MessageItem } from '@/components/chat/MessageItem';
import { Button } from '@/components/ui/button';

const NEAR_BOTTOM_THRESHOLD_PX = 100;

export function MessageList({ channelId }: { channelId: string }) {
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useChannelMessages(channelId);
  const { data: currentUser } = useCurrentUser();
  const containerRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);

  const messages = data ? [...data.pages].reverse().flatMap((page) => page.messages) : [];

  useEffect(() => {
    const container = containerRef.current;
    if (container && wasNearBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length]);

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
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} isOwn={message.authorId === currentUser?.id} />
      ))}
    </div>
  );
}
