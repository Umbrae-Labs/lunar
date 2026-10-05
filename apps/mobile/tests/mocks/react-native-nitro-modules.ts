export const NitroModules = {
  createHybridObject<T>(_name: string): T {
    throw new Error('NitroModules is unavailable in the unit-test runtime.');
  },
};
