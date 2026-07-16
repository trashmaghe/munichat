import { z } from 'zod';
import { messageSchema } from './message.dto';

export const messageSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  channelId: z.string().optional(),
  cursor: z.string().optional(),
});

export type MessageSearchQuery = z.infer<typeof messageSearchQuerySchema>;

export const messageSearchResponseSchema = z.object({
  messages: z.array(messageSchema),
  nextCursor: z.string().nullable(),
});

export type MessageSearchResponse = z.infer<typeof messageSearchResponseSchema>;
