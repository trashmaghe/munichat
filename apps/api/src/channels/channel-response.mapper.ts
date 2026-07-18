import { Channel, ChannelMember, User } from '@prisma/client';
import { ChannelMemberSummary, ChannelSummary } from '@elyzian/shared';
import { toUserSummary } from '../users/user-summary.mapper';

export function toChannelSummary(
  channel: Channel,
  unreadCount: number,
): ChannelSummary {
  return {
    id: channel.id,
    name: channel.name,
    displayName: channel.displayName,
    type: channel.type,
    createdAt: channel.createdAt.toISOString(),
    unreadCount,
  };
}

export function toChannelMemberSummary(
  member: ChannelMember & { user: User },
): ChannelMemberSummary {
  return {
    userId: member.userId,
    channelId: member.channelId,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
    user: toUserSummary(member.user),
  };
}
