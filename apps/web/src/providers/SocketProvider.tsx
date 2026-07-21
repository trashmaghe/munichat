import { useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  SocketEvent,
  type Message,
  type PresenceSyncPayload,
  type PresenceUpdatePayload,
  type TypingBroadcast,
} from '@elyzian/shared';
import { getSocket } from '@/lib/socket';
import { appendMessageToCache, updateMessageInCache } from '@/lib/message-cache';
import { incrementUnreadCountInCache } from '@/lib/channel-cache';
import { shouldNotify, showMessageNotification } from '@/lib/notifications';
import { useChatStore } from '@/stores/useChatStore';
import { useUIStore } from '@/stores/useUIStore';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const TYPING_EXPIRY_MS = 5000;
const TYPING_PRUNE_INTERVAL_MS = 1000;

export function SocketProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const currentUserIdRef = useRef(currentUser?.id);

  useEffect(() => {
    currentUserIdRef.current = currentUser?.id;
  }, [currentUser?.id]);

  useEffect(() => {
    const socket = getSocket();

    function handleMessageNew(message: Message) {
      appendMessageToCache(queryClient, message);

      const activeChannelId = useChatStore.getState().activeChannelId;
      // A message that isn't for the channel currently open bumps its
      // unread badge; MessageList.tsx handles marking the active channel
      // itself read as it renders new messages near the bottom.
      if (message.channelId !== activeChannelId) {
        incrementUnreadCountInCache(queryClient, message.channelId);
      }

      if (
        typeof Notification !== 'undefined' &&
        shouldNotify({
          message,
          currentUserId: currentUserIdRef.current,
          activeChannelId,
          documentVisibilityState: document.visibilityState,
          permission: Notification.permission,
          notificationsEnabled: useUIStore.getState().notificationsEnabled,
        })
      ) {
        showMessageNotification(message);
      }
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
    // socket.io retries with backoff on its own (reconnectionAttempts is
    // Infinity by default) and a single connect_error is often just a
    // transient hiccup - e.g. the very first handshake racing the browser
    // committing the just-issued access_token cookie. Only treat it as a
    // dead session once several attempts in a row have failed; a lone
    // failure used to force a full logout/redirect-to-login on otherwise
    // successful logins.
    const CONSECUTIVE_FAILURES_BEFORE_LOGOUT = 3;
    let consecutiveFailures = 0;
    function handleConnect() {
      consecutiveFailures = 0;
    }
    function handleConnectError() {
      consecutiveFailures += 1;
      if (consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_LOGOUT) {
        queryClient.setQueryData(['currentUser'], null);
      }
    }

    socket.on(SocketEvent.MESSAGE_NEW, handleMessageNew);
    socket.on(SocketEvent.MESSAGE_UPDATED, handleMessageUpdated);
    socket.on(SocketEvent.PRESENCE_SYNC, handlePresenceSync);
    socket.on(SocketEvent.PRESENCE_UPDATE, handlePresenceUpdate);
    socket.on(SocketEvent.TYPING_START, handleTypingStart);
    socket.on(SocketEvent.TYPING_STOP, handleTypingStop);
    socket.on('connect', handleConnect);
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
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.disconnect();
    };
  }, [queryClient]);

  return <>{children}</>;
}
