import { z } from 'zod';
import { ChannelType, MemberRole } from './enums';
import { userSummarySchema } from './user.dto';

export const channelSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  type: z.nativeEnum(ChannelType),
  createdAt: z.string(),
  unreadCount: z.number(),
});

export type ChannelSummary = z.infer<typeof channelSummarySchema>;

export const channelMemberSummarySchema = z.object({
  userId: z.string(),
  channelId: z.string(),
  role: z.nativeEnum(MemberRole),
  joinedAt: z.string(),
  user: userSummarySchema,
});

export type ChannelMemberSummary = z.infer<typeof channelMemberSummarySchema>;
