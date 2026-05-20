import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CurrentUser } from './api';

interface AppState {
  // Server-side user (resolved on bootstrap)
  currentUser: CurrentUser | null;
  setCurrentUser: (u: CurrentUser | null) => void;

  // UI selection (per-user, namespaced by username on persist)
  currentAccountId: string | null;
  setCurrentAccountId: (id: string | null) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      currentUser: null,
      setCurrentUser: (u) => set({ currentUser: u }),
      currentAccountId: null,
      setCurrentAccountId: (id) => set({ currentAccountId: id }),
      sidebarCollapsed: false,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
    }),
    {
      name: 'bvp-app-state',
      // Persist only UI state; user is re-fetched on every load via /v1/auth/me
      partialize: (s) => ({
        currentAccountId: s.currentAccountId,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    }
  )
);
