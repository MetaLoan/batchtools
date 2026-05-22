import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CurrentUser } from './api';

export interface CapabilityFormState {
  modelVariant?: string;
  prompt?: string;
  negativePrompt?: string;
  media?: any[];
  parameters?: Record<string, any>;
  matrix?: any;
}

interface AppState {
  // Server-side user (resolved on bootstrap)
  currentUser: CurrentUser | null;
  setCurrentUser: (u: CurrentUser | null) => void;

  // UI selection (per-user, namespaced by username on persist)
  currentAccountId: string | null;
  setCurrentAccountId: (id: string | null) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;

  // Persistence of form inputs and selections
  capabilityForms: Record<string, CapabilityFormState>;
  setCapabilityForm: (capabilityId: string, form: Partial<CapabilityFormState>) => void;

  tasksFilter: {
    filterCap?: string;
    filterStatus?: string;
    search: string;
  };
  setTasksFilter: (filter: Partial<AppState['tasksFilter']>) => void;

  assetsActiveTab: string;
  setAssetsActiveTab: (tab: string) => void;

  // Track acknowledged finished jobs to show count of newly finished jobs
  acknowledgedFinishedJobIds: string[];
  setAcknowledgedFinishedJobIds: (ids: string[]) => void;
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

      capabilityForms: {},
      setCapabilityForm: (capabilityId, form) =>
        set((state) => ({
          capabilityForms: {
            ...state.capabilityForms,
            [capabilityId]: {
              ...(state.capabilityForms[capabilityId] || {}),
              ...form,
            },
          },
        })),

      tasksFilter: {
        filterCap: undefined,
        filterStatus: undefined,
        search: '',
      },
      setTasksFilter: (filter) =>
        set((state) => ({
          tasksFilter: {
            ...state.tasksFilter,
            ...filter,
          },
        })),

      assetsActiveTab: 'uploads',
      setAssetsActiveTab: (tab) => set({ assetsActiveTab: tab }),

      acknowledgedFinishedJobIds: [],
      setAcknowledgedFinishedJobIds: (ids) => set({ acknowledgedFinishedJobIds: ids }),
    }),
    {
      name: 'bvp-app-state',
      // Persist only UI state; user is re-fetched on every load via /v1/auth/me
      partialize: (s) => ({
        currentAccountId: s.currentAccountId,
        sidebarCollapsed: s.sidebarCollapsed,
        capabilityForms: s.capabilityForms,
        tasksFilter: s.tasksFilter,
        assetsActiveTab: s.assetsActiveTab,
        acknowledgedFinishedJobIds: s.acknowledgedFinishedJobIds,
      }),
    }
  )
);

