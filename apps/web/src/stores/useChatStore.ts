import { create } from 'zustand';

type TypingByChannel = Record<string, Record<string, number>>;

interface ChatState {
  activeChannelId: string | null;
  setActiveChannelId: (channelId: string | null) => void;
  typingUsersByChannel: TypingByChannel;
  addTyping: (channelId: string, userId: string, expiryMs: number) => void;
  removeTyping: (channelId: string, userId: string) => void;
  pruneExpiredTyping: (now: number) => void;
  onlineUserIds: Set<string>;
  setOnlineUsers: (userIds: string[]) => void;
  setUserOnline: (userId: string, online: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeChannelId: null,
  setActiveChannelId: (activeChannelId) => set({ activeChannelId }),

  typingUsersByChannel: {},
  addTyping: (channelId, userId, expiryMs) =>
    set((state) => ({
      typingUsersByChannel: {
        ...state.typingUsersByChannel,
        [channelId]: { ...state.typingUsersByChannel[channelId], [userId]: expiryMs },
      },
    })),
  removeTyping: (channelId, userId) =>
    set((state) => {
      if (!state.typingUsersByChannel[channelId]) {
        return state;
      }
      const channelTyping = { ...state.typingUsersByChannel[channelId] };
      delete channelTyping[userId];
      return {
        typingUsersByChannel: { ...state.typingUsersByChannel, [channelId]: channelTyping },
      };
    }),
  pruneExpiredTyping: (now) =>
    set((state) => {
      const next: TypingByChannel = {};
      for (const [channelId, users] of Object.entries(state.typingUsersByChannel)) {
        const filtered = Object.fromEntries(Object.entries(users).filter(([, expiry]) => expiry > now));
        if (Object.keys(filtered).length > 0) {
          next[channelId] = filtered;
        }
      }
      return { typingUsersByChannel: next };
    }),

  onlineUserIds: new Set(),
  setOnlineUsers: (userIds) => set({ onlineUserIds: new Set(userIds) }),
  setUserOnline: (userId, online) =>
    set((state) => {
      const next = new Set(state.onlineUserIds);
      if (online) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return { onlineUserIds: next };
    }),
}));
