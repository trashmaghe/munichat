import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { Message, MessageHistoryResponse } from '@elyzian/shared';

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

// An edited/deleted/link-preview-updated message can be on any loaded page
// (unlike a freshly-sent one, which is always on the newest), so this has to
// search every page rather than just prepending to pages[0].
export function updateMessageInCache(
  queryClient: QueryClient,
  channelId: string,
  message: Message,
): void {
  const queryKey = ['channels', channelId, 'messages'];
  queryClient.setQueryData<InfiniteData<MessageHistoryResponse>>(queryKey, (data) => {
    if (!data) {
      return data;
    }
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        messages: page.messages.map((existing) =>
          existing.id === message.id ? message : existing,
        ),
      })),
    };
  });
}
