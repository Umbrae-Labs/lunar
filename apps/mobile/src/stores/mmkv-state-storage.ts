import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

const preferencesStorage = createMMKV({
  id: 'lunar.preferences',
  compareBeforeSet: true,
});

export const mmkvStateStorage: StateStorage = {
  getItem: (name) => preferencesStorage.getString(name) ?? null,
  setItem: (name, value) => {
    preferencesStorage.set(name, value);
  },
  removeItem: (name) => {
    preferencesStorage.remove(name);
  },
};
