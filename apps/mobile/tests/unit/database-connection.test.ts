import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('expo-sqlite');
  vi.resetModules();
});

describe('Lunar database connection', () => {
  it('shares one initialized connection across concurrent callers', async () => {
    const database = createDatabaseStub();
    const openDatabaseAsync = vi.fn(async () => database);
    vi.doMock('expo-sqlite', () => ({ openDatabaseAsync }));
    const { getLunarDatabase } = await import('../../src/db/database');

    const [first, second] = await Promise.all([
      getLunarDatabase(),
      getLunarDatabase(),
    ]);

    expect(first).toBe(database);
    expect(second).toBe(database);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(database.execAsync).toHaveBeenCalledTimes(1);
    expect(database.getFirstAsync).toHaveBeenCalledTimes(1);
  });

  it('allows initialization to retry after an opening failure', async () => {
    const database = createDatabaseStub();
    const openDatabaseAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error('opening failed'))
      .mockResolvedValueOnce(database);
    vi.doMock('expo-sqlite', () => ({ openDatabaseAsync }));
    const { getLunarDatabase } = await import('../../src/db/database');

    await expect(getLunarDatabase()).rejects.toThrow('opening failed');
    await expect(getLunarDatabase()).resolves.toBe(database);

    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
  });
});

function createDatabaseStub() {
  return {
    execAsync: vi.fn(async () => undefined),
    getFirstAsync: vi.fn(async () => ({ user_version: 2 })),
    withExclusiveTransactionAsync: vi.fn(async () => undefined),
  };
}
