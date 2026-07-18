import { z } from 'zod';
import {
  channelMemberSummarySchema,
  channelSummarySchema,
  messageHistoryResponseSchema,
  messageSearchResponseSchema,
  type ChannelMemberSummary,
  type ChannelSummary,
  type MessageHistoryResponse,
  type MessageSearchResponse,
} from '@elyzian/shared';
import { apiFetch } from '@/lib/api-client';

export async function fetchChannels(): Promise<ChannelSummary[]> {
  const res = await apiFetch<unknown>('/channels');
  return z.array(channelSummarySchema).parse(res);
}

export async function fetchChannelMembers(channelId: string): Promise<ChannelMemberSummary[]> {
  const res = await apiFetch<unknown>(`/channels/${channelId}/members`);
  return z.array(channelMemberSummarySchema).parse(res);
}

export async function fetchMessageHistory(
  channelId: string,
  cursor: string | undefined,
): Promise<MessageHistoryResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const res = await apiFetch<unknown>(`/channels/${channelId}/messages${query}`);
  return messageHistoryResponseSchema.parse(res);
}

export async function fetchMessageSearch(
  q: string,
  channelId: string | undefined,
  cursor: string | undefined,
): Promise<MessageSearchResponse> {
  const params = new URLSearchParams({ q });
  if (channelId) params.set('channelId', channelId);
  if (cursor) params.set('cursor', cursor);
  const res = await apiFetch<unknown>(`/messages/search?${params.toString()}`);
  return messageSearchResponseSchema.parse(res);
}
