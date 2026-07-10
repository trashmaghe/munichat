import { io, type Socket } from 'socket.io-client';
import { SocketEvent, type Message } from '@munichat/shared';

let socket: Socket | null = null;

export function getSocket(): Socket {
  socket ??= io(import.meta.env.VITE_WS_URL, {
    withCredentials: true,
    autoConnect: false,
  });
  return socket;
}

export function sendMessage(channelId: string, content: string): Promise<Message> {
  return new Promise((resolve, reject) => {
    getSocket().emit(
      SocketEvent.MESSAGE_SEND,
      { channelId, content },
      (ack: { message: Message } | { error: string }) => {
        if ('error' in ack) {
          reject(new Error(ack.error));
        } else {
          resolve(ack.message);
        }
      },
    );
  });
}
