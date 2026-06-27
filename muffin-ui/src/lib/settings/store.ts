import { create } from 'zustand';

import { storage } from '@/lib/storage';

export type LlmProvider = 'openai' | 'anthropic' | 'openrouter';

/**
 * User-owned configuration. Per the "bring your own keys" model, these live
 * on-device only and are injected into each run's `configurable` — never
 * persisted server-side by the client.
 */
export interface Settings {
  /** LangGraph server base URL. Web defaults to the same-origin `/api` proxy. */
  apiUrl: string;
  /** Optional bearer / Cloudflare Access service token for the API. */
  authToken: string;
  /** Stable identity for per-user memory isolation (configurable.user_id). */
  userId: string;
  llmProvider: LlmProvider;
  model: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  openrouterApiKey: string;
  /** OpenBB personal access token (BYO market-data key). */
  openbbApiKey: string;
}

export const DEFAULT_SETTINGS: Settings = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '/api',
  authToken: '',
  userId: '',
  llmProvider: 'openrouter',
  model: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  openrouterApiKey: '',
  openbbApiKey: '',
};

const STORAGE_KEY = 'muffin.settings.v1';

function load(): Settings {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsState extends Settings {
  setMany: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  setMany: (patch) => {
    set(patch);
    const { setMany, reset, ...values } = get();
    storage.set(STORAGE_KEY, JSON.stringify(values));
  },
  reset: () => {
    set(DEFAULT_SETTINGS);
    storage.delete(STORAGE_KEY);
  },
}));

/** Non-reactive snapshot for use outside React (e.g. building a run config). */
export const getSettings = (): Settings => {
  const { setMany, reset, ...values } = useSettings.getState();
  return values;
};
