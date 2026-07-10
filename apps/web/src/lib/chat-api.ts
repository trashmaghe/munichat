import { z } from 'zod';
import {
  channelMemberSummarySchema,
  channelSummarySchema,
  messageHistoryResponseSchema,
  type ChannelMemberSummary,
  type ChannelSummary,
  type MessageHistoryResponse,
} from '@munichat/shared';
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
