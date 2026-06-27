import { create } from 'zustand';

import { storage } from '@/lib/storage';
import { DEMO_ACCOUNTS, DEMO_GOALS, uid, type Account, type Goal, type Holding } from './portfolio';

interface WealthData {
  baseCurrency: string;
  accounts: Account[];
  goals: Goal[];
}

const DEFAULT: WealthData = { baseCurrency: '£', accounts: DEMO_ACCOUNTS, goals: DEMO_GOALS };
const STORAGE_KEY = 'muffin.wealth.v1';

function load(): WealthData {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return DEFAULT;
  try {
    return { ...DEFAULT, ...(JSON.parse(raw) as Partial<WealthData>) };
  } catch {
    return DEFAULT;
  }
}

interface WealthState extends WealthData {
  addHolding: (accountId: string, holding: Omit<Holding, 'id'>) => void;
  removeHolding: (accountId: string, holdingId: string) => void;
  addGoal: (goal: Omit<Goal, 'id'>) => string;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  removeGoal: (id: string) => void;
  resetToDemo: () => void;
}

export const useWealth = create<WealthState>((set, get) => {
  const persist = () => {
    const { baseCurrency, accounts, goals } = get();
    storage.set(STORAGE_KEY, JSON.stringify({ baseCurrency, accounts, goals }));
  };

  return {
    ...load(),

    addHolding: (accountId, holding) => {
      set((s) => ({
        accounts: s.accounts.map((a) =>
          a.id === accountId ? { ...a, holdings: [...a.holdings, { ...holding, id: uid() }] } : a,
        ),
      }));
      persist();
    },

    removeHolding: (accountId, holdingId) => {
      set((s) => ({
        accounts: s.accounts.map((a) =>
          a.id === accountId ? { ...a, holdings: a.holdings.filter((h) => h.id !== holdingId) } : a,
        ),
      }));
      persist();
    },

    addGoal: (goal) => {
      const id = `goal-${uid()}`;
      set((s) => ({ goals: [...s.goals, { ...goal, id }] }));
      persist();
      return id;
    },

    updateGoal: (id, patch) => {
      set((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
      persist();
    },

    removeGoal: (id) => {
      set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }));
      persist();
    },

    resetToDemo: () => {
      set({ ...DEFAULT });
      storage.delete(STORAGE_KEY);
    },
  };
});
