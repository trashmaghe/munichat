import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  SocketEvent,
  type Message,
  type PresenceSyncPayload,
  type PresenceUpdatePayload,
  type TypingBroadcast,
} from '@munichat/shared';
import { getSocket } from '@/lib/socket';
import { appendMessageToCache, updateMessageInCache } from '@/lib/message-cache';
import { useChatStore } from '@/stores/useChatStore';

const TYPING_EXPIRY_MS = 5000;
const TYPING_PRUNE_INTERVAL_MS = 1000;

export function SocketProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    function handleMessageNew(message: Message) {
      appendMessageToCache(queryClient, message);
    }
    function handleMessageUpdated(message: Message) {
      updateMessageInCache(queryClient, message.channelId, message);
    }
    function handlePresenceSync(payload: PresenceSyncPayload) {
      useChatStore.getState().setOnlineUsers(payload.onlineUserIds);
    }
    function handlePresenceUpdate(payload: PresenceUpdatePayload) {
      useChatStore.getState().setUserOnline(payload.userId, payload.online);
    }
    function handleTypingStart(payload: TypingBroadcast) {
      useChatStore.getState().addTyping(payload.channelId, payload.userId, Date.now() + TYPING_EXPIRY_MS);
    }
    function handleTypingStop(payload: TypingBroadcast) {
      useChatStore.getState().removeTyping(payload.channelId, payload.userId);
    }
    function handleConnectError() {
      queryClient.setQueryData(['currentUser'], null);
    }

    socket.on(SocketEvent.MESSAGE_NEW, handleMessageNew);
    socket.on(SocketEvent.MESSAGE_UPDATED, handleMessageUpdated);
    socket.on(SocketEvent.PRESENCE_SYNC, handlePresenceSync);
    socket.on(SocketEvent.PRESENCE_UPDATE, handlePresenceUpdate);
    socket.on(SocketEvent.TYPING_START, handleTypingStart);
    socket.on(SocketEvent.TYPING_STOP, handleTypingStop);
    socket.on('connect_error', handleConnectError);
    socket.connect();

    const pruneInterval = setInterval(() => {
      useChatStore.getState().pruneExpiredTyping(Date.now());
    }, TYPING_PRUNE_INTERVAL_MS);

    return () => {
      clearInterval(pruneInterval);
      socket.off(SocketEvent.MESSAGE_NEW, handleMessageNew);
      socket.off(SocketEvent.MESSAGE_UPDATED, handleMessageUpdated);
      socket.off(SocketEvent.PRESENCE_SYNC, handlePresenceSync);
      socket.off(SocketEvent.PRESENCE_UPDATE, handlePresenceUpdate);
      socket.off(SocketEvent.TYPING_START, handleTypingStart);
      socket.off(SocketEvent.TYPING_STOP, handleTypingStop);
      socket.off('connect_error', handleConnectError);
      socket.disconnect();
    };
  }, [queryClient]);

  return <>{children}</>;
}
