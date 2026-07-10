import { z } from 'zod';
import { MessageType } from './enums';
import { userSummarySchema } from './user.dto';

export const messageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  authorId: z.string(),
  content: z.string(),
  type: z.nativeEnum(MessageType),
  replyToId: z.string().nullable(),
  editedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  author: userSummarySchema,
});

export type Message = z.infer<typeof messageSchema>;

export const sendMessageRequestSchema = z.object({
  channelId: z.string(),
  content: z.string().trim().min(1).max(4000),
});

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const messageHistoryResponseSchema = z.object({
  messages: z.array(messageSchema),
  nextCursor: z.string().nullable(),
});

export type MessageHistoryResponse = z.infer<typeof messageHistoryResponseSchema>;
