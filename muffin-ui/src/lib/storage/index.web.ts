import type { KeyValueStore } from './types';

/** Browser localStorage backend (with an in-memory fallback for SSR export). */
const mem = new Map<string, string>();

function ls(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const storage: KeyValueStore = {
  getString: (key) => ls()?.getItem(key) ?? mem.get(key) ?? undefined,
  set: (key, value) => {
    mem.set(key, value);
    ls()?.setItem(key, value);
  },
  delete: (key) => {
    mem.delete(key);
    ls()?.removeItem(key);
  },
};
