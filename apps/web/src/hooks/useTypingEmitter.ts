import { useCallback, useEffect, useRef } from 'react';
import { SocketEvent } from '@munichat/shared';
import { getSocket } from '@/lib/socket';

const TYPING_STOP_DELAY_MS = 2000;

export function useTypingEmitter(channelId: string) {
  const isTypingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTyping = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (isTypingRef.current) {
      isTypingRef.current = false;
      getSocket().emit(SocketEvent.TYPING_STOP, { channelId });
    }
  }, [channelId]);

  const notifyTyping = useCallback(() => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      getSocket().emit(SocketEvent.TYPING_START, { channelId });
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(stopTyping, TYPING_STOP_DELAY_MS);
  }, [channelId, stopTyping]);

  useEffect(() => stopTyping, [stopTyping]);

  return { notifyTyping, stopTyping };
}
