import { io, type Socket } from 'socket.io-client';
import { SocketEvent, type Message, type PendingAttachment } from '@munichat/shared';

let socket: Socket | null = null;

export function getSocket(): Socket {
  socket ??= io(import.meta.env.VITE_WS_URL, {
    withCredentials: true,
    autoConnect: false,
  });
  return socket;
}

type MessageMutationAck = { message: Message } | { error: string };

function emitForMessage(event: SocketEvent, payload: unknown): Promise<Message> {
  return new Promise((resolve, reject) => {
    getSocket().emit(event, payload, (ack: MessageMutationAck) => {
      if ('error' in ack) {
        reject(new Error(ack.error));
      } else {
        resolve(ack.message);
      }
    });
  });
}

export interface SendMessageOptions {
  replyToId?: string | null;
  attachments?: PendingAttachment[];
}

export function sendMessage(
  channelId: string,
  content: string,
  options: SendMessageOptions = {},
): Promise<Message> {
  return emitForMessage(SocketEvent.MESSAGE_SEND, {
    channelId,
    content,
    replyToId: options.replyToId,
    attachments: options.attachments,
  });
}

export function editMessage(messageId: string, content: string): Promise<Message> {
  return emitForMessage(SocketEvent.MESSAGE_EDIT, { messageId, content });
}

export function deleteMessage(messageId: string): Promise<Message> {
  return emitForMessage(SocketEvent.MESSAGE_DELETE, { messageId });
}

type ChannelReadAck = { ok: true } | { error: string };

export function markChannelRead(
  channelId: string,
  messageId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    getSocket().emit(
      SocketEvent.CHANNEL_READ,
      { channelId, messageId },
      (ack: ChannelReadAck) => {
        if ('error' in ack) {
          reject(new Error(ack.error));
        } else {
          resolve();
        }
      },
    );
  });
}
