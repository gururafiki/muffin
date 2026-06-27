import { MMKV } from 'react-native-mmkv';

import type { KeyValueStore } from './types';

const mmkv = new MMKV({ id: 'muffin-settings' });

export const storage: KeyValueStore = {
  getString: (key) => mmkv.getString(key),
  set: (key, value) => mmkv.set(key, value),
  delete: (key) => mmkv.delete(key),
};
