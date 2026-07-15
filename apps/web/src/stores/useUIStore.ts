import { create } from 'zustand';

function getInitialNotificationsEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem('notificationsEnabled') === 'true';
}

interface UIState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  notificationsEnabled: getInitialNotificationsEnabled(),
  setNotificationsEnabled: (enabled) => {
    localStorage.setItem('notificationsEnabled', String(enabled));
    set({ notificationsEnabled: enabled });
  },
}));
