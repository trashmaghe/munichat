import { z } from 'zod';

export const SocketEvent = {
  MESSAGE_SEND: 'message:send',
  MESSAGE_NEW: 'message:new',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  PRESENCE_SYNC: 'presence:sync',
  PRESENCE_UPDATE: 'presence:update',
} as const;
export type SocketEvent = (typeof SocketEvent)[keyof typeof SocketEvent];

export const typingClientPayloadSchema = z.object({
  channelId: z.string(),
});

export type TypingClientPayload = z.infer<typeof typingClientPayloadSchema>;

export const typingBroadcastSchema = typingClientPayloadSchema.extend({
  userId: z.string(),
});

export type TypingBroadcast = z.infer<typeof typingBroadcastSchema>;

export const presenceSyncPayloadSchema = z.object({
  onlineUserIds: z.array(z.string()),
});

export type PresenceSyncPayload = z.infer<typeof presenceSyncPayloadSchema>;

export const presenceUpdatePayloadSchema = z.object({
  userId: z.string(),
  online: z.boolean(),
});

export type PresenceUpdatePayload = z.infer<typeof presenceUpdatePayloadSchema>;
