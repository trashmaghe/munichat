import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { Message, MessageHistoryResponse } from '@munichat/shared';

// useChannelMessages pages are ordered newest-fetched-first (pages[0] is the
// most recent window, ascending oldest->newest within it); a live message
// belongs at the end of pages[0] so [...pages].reverse().flatMap(...) still
// renders in chronological order.
export function appendMessageToCache(queryClient: QueryClient, message: Message): void {
  const queryKey = ['channels', message.channelId, 'messages'];
  queryClient.setQueryData<InfiniteData<MessageHistoryResponse>>(queryKey, (data) => {
    if (!data || data.pages.length === 0) {
      return data;
    }
    const [firstPage, ...rest] = data.pages;
    return {
      ...data,
      pages: [{ ...firstPage, messages: [...firstPage.messages, message] }, ...rest],
    };
  });
}
