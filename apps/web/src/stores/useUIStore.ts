import { create } from 'zustand';

function getInitialNotificationsEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem('notificationsEnabled') === 'true';
}

type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'light';
  return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
}

interface UIState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
  theme: Theme;
  toggleTheme: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  notificationsEnabled: getInitialNotificationsEnabled(),
  setNotificationsEnabled: (enabled) => {
    localStorage.setItem('notificationsEnabled', String(enabled));
    set({ notificationsEnabled: enabled });
  },
  theme: getInitialTheme(),
  toggleTheme: () =>
    set((state) => {
      const theme: Theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', theme);
      return { theme };
    }),
}));
