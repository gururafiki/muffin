import type { KeyValueStore } from './types';

export type { KeyValueStore } from './types';

/**
 * Fallback used only for TypeScript resolution and unexpected platforms. Metro
 * resolves `index.web.ts` (browser) or `index.native.ts` (iOS/Android) first.
 */
const mem = new Map<string, string>();

export const storage: KeyValueStore = {
  getString: (key) => mem.get(key),
  set: (key, value) => mem.set(key, value),
  delete: (key) => mem.delete(key),
};
