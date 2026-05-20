import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  currentAccountId: string | null;
  setCurrentAccountId: (id: string | null) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      currentAccountId: null,
      setCurrentAccountId: (id) => set({ currentAccountId: id }),
      sidebarCollapsed: false,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
    }),
    { name: 'bvp-app-state' }
  )
);
