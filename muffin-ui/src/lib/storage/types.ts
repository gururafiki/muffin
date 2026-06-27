/**
 * Minimal synchronous key/value contract used by the settings store.
 *
 * Implemented per-platform so Metro picks the right backend:
 *  - native (iOS/Android): MMKV  (storage.native.ts) — needs a dev/EAS build.
 *  - web: localStorage          (storage.web.ts)
 *
 * Keeping it behind this interface means swapping to SecureStore for sensitive
 * keys later is a one-file change.
 */
export interface KeyValueStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}
