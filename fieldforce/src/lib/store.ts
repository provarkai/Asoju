import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AgentProfile,
  AppTab,
  Gig,
  Mission,
  PayoutRecord,
  SupportMessage,
  OfflineQueueItem,
  WalletSummary,
} from '@/lib/types';

// ─── App Store ──────────────────────────────────────────────────────────────

interface AppState {
  // Navigation
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;

  // Agent
  agent: AgentProfile | null;
  setAgent: (agent: AgentProfile | null) => void;
  isOnboarded: boolean;
  setIsOnboarded: (val: boolean) => void;

  // Onboarding
  onboardingStep: number;
  setOnboardingStep: (step: number) => void;

  // Gigs (marketplace)
  gigs: Gig[];
  setGigs: (gigs: Gig[]) => void;
  addGig: (gig: Gig) => void;
  removeGig: (caseId: string) => void;

  // Missions (accepted gigs)
  missions: Mission[];
  setMissions: (missions: Mission[]) => void;
  updateMission: (caseId: string, updates: Partial<Mission>) => void;
  addMission: (mission: Mission) => void;

  // Active mission (selected for execution)
  activeMissionId: string | null;
  setActiveMissionId: (id: string | null) => void;

  // Wallet
  walletSummary: WalletSummary | null;
  setWalletSummary: (summary: WalletSummary | null) => void;

  // Earnings
  payouts: PayoutRecord[];
  setPayouts: (payouts: PayoutRecord[]) => void;

  // Support
  supportMessages: SupportMessage[];
  setSupportMessages: (msgs: SupportMessage[]) => void;
  addSupportMessage: (msg: SupportMessage) => void;

  // Offline
  isOnline: boolean;
  setIsOnline: (val: boolean) => void;
  offlineQueue: OfflineQueueItem[];
  addToOfflineQueue: (item: OfflineQueueItem) => void;
  removeFromOfflineQueue: (idempotencyKey: string) => void;
  clearSyncedItems: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Navigation
      activeTab: 'gigs',
      setActiveTab: (tab) => set({ activeTab: tab }),

      // Agent
      agent: null,
      setAgent: (agent) => set({ agent }),
      isOnboarded: false,
      setIsOnboarded: (val) => set({ isOnboarded: val }),

      // Onboarding
      onboardingStep: 1,
      setOnboardingStep: (step) => set({ onboardingStep: step }),

      // Gigs
      gigs: [],
      setGigs: (gigs) => set({ gigs }),
      addGig: (gig) => set((s) => ({ gigs: [gig, ...s.gigs] })),
      removeGig: (caseId) => set((s) => ({ gigs: s.gigs.filter((g) => g.caseId !== caseId) })),

      // Missions
      missions: [],
      setMissions: (missions) => set({ missions }),
      updateMission: (caseId, updates) =>
        set((s) => ({
          missions: s.missions.map((m) => (m.caseId === caseId ? { ...m, ...updates } : m)),
        })),
      addMission: (mission) => set((s) => ({ missions: [mission, ...s.missions] })),

      // Active mission
      activeMissionId: null,
      setActiveMissionId: (id) => set({ activeMissionId: id }),

      // Wallet
      walletSummary: null,
      setWalletSummary: (summary) => set({ walletSummary: summary }),

      // Earnings
      payouts: [],
      setPayouts: (payouts) => set({ payouts }),

      // Support
      supportMessages: [],
      setSupportMessages: (msgs) => set({ supportMessages: msgs }),
      addSupportMessage: (msg) =>
        set((s) => ({ supportMessages: [...s.supportMessages, msg] })),

      // Offline
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      setIsOnline: (val) => set({ isOnline: val }),
      offlineQueue: [],
      addToOfflineQueue: (item) =>
        set((s) => ({ offlineQueue: [...s.offlineQueue, item] })),
      removeFromOfflineQueue: (idempotencyKey) =>
        set((s) => ({
          offlineQueue: s.offlineQueue.filter(
            (q) => q.idempotencyKey !== idempotencyKey
          ),
        })),
      clearSyncedItems: () => set({ offlineQueue: [] }),
    }),
    {
      name: 'asoju-fieldforce-store',
      storage: createJSONStorage(() => {
        if (typeof window !== 'undefined') return localStorage;
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
      }),
      partialize: (state) => ({
        agent: state.agent,
        isOnboarded: state.isOnboarded,
        activeTab: state.activeTab,
      }),
    }
  )
);
