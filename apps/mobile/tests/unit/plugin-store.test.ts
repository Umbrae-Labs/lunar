import { afterEach, describe, expect, it, vi } from 'vitest';

import { mmkvStateStorage } from '../../src/stores/mmkv-state-storage';
import { MAX_PLUGIN_TABS, usePluginStore } from '../../src/stores/plugin-store';

const persistedValues = vi.hoisted(() => new Map<string, string>());

vi.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => persistedValues.get(key),
    set: (key: string, value: string) => {
      persistedValues.set(key, value);
    },
    remove: (key: string) => persistedValues.delete(key),
  }),
}));

const PLUGIN_SETTINGS_KEY = 'settings.plugins';

afterEach(() => {
  usePluginStore.setState({ enabled: {}, order: [], tabs: [], catalogs: [], settings: {}, credentials: {} });
  mmkvStateStorage.removeItem(PLUGIN_SETTINGS_KEY);
});

describe('plugin tab pins', () => {
  it('pins plugins in order up to the bottom navigation limit and persists them', () => {
    const ids = Array.from({ length: MAX_PLUGIN_TABS + 1 }, (_, index) => `org.example.p${index}`);
    for (const id of ids) usePluginStore.getState().setTabPinned(id, true);
    usePluginStore.getState().setTabPinned(ids[0], true);

    const pinned = ids.slice(0, MAX_PLUGIN_TABS);
    expect(usePluginStore.getState().tabs).toEqual(pinned);
    const persisted = JSON.parse(mmkvStateStorage.getItem(PLUGIN_SETTINGS_KEY) as string) as {
      state: { tabs: string[] };
    };
    expect(persisted.state.tabs).toEqual(pinned);
  });

  it('unpins on request and when the plugin is removed', () => {
    const store = usePluginStore.getState();
    store.setTabPinned('org.example.a', true);
    store.setTabPinned('org.example.b', true);
    store.setTabPinned('org.example.a', false);
    expect(usePluginStore.getState().tabs).toEqual(['org.example.b']);
    usePluginStore.getState().removePlugin('org.example.b');
    expect(usePluginStore.getState().tabs).toEqual([]);
  });

  it('restores pins written before the limit or without the field', async () => {
    mmkvStateStorage.setItem(
      PLUGIN_SETTINGS_KEY,
      JSON.stringify({ state: { tabs: ['org.example.a', 'org.example.a', 4, 'b', 'c'] }, version: 0 }),
    );
    await usePluginStore.persist.rehydrate();
    expect(usePluginStore.getState().tabs).toEqual(['org.example.a', 'b', 'c'].slice(0, MAX_PLUGIN_TABS));

    mmkvStateStorage.setItem(PLUGIN_SETTINGS_KEY, JSON.stringify({ state: { enabled: {} }, version: 0 }));
    await usePluginStore.persist.rehydrate();
    expect(usePluginStore.getState().tabs).toEqual([]);
  });
});

describe('plugin catalogs', () => {
  const key = { kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' } as const;
  const catalog = {
    url: 'https://example.com/index.json',
    name: 'Example',
    keyId: 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k',
    key,
    addedAt: 1,
  };

  it('starts without catalogs and keeps the pinned key when details change', () => {
    expect(usePluginStore.getState().catalogs).toEqual([]);
    usePluginStore.getState().addCatalog(catalog);
    usePluginStore.getState().updateCatalog(catalog.url, { name: 'Renamed', badge: 'EX', website: undefined });
    expect(usePluginStore.getState().catalogs).toEqual([
      { ...catalog, name: 'Renamed', badge: 'EX', website: undefined },
    ]);
    usePluginStore.getState().removeCatalog(catalog.url);
    expect(usePluginStore.getState().catalogs).toEqual([]);
  });

  it('restores well-formed catalogs only, once per address', async () => {
    mmkvStateStorage.setItem(
      PLUGIN_SETTINGS_KEY,
      JSON.stringify({
        state: {
          catalogs: [catalog, { ...catalog, name: 'Duplicate' }, { ...catalog, url: 'x', key: { kty: 'RSA' } }],
        },
        version: 0,
      }),
    );
    await usePluginStore.persist.rehydrate();
    expect(usePluginStore.getState().catalogs).toEqual([{ ...catalog, badge: undefined, website: undefined }]);
  });
});

describe('plugin credentials', () => {
  const record = { baseUrl: 'https://api.example.com/v1', updatedAt: 1 };

  it('persists only the address and forgets it with the plugin', () => {
    const store = usePluginStore.getState();
    store.setCredential('org.example.a', 'api', record);
    store.setCredential('org.example.a', 'other', record);
    store.setCredential('org.example.a', 'other', undefined);
    expect(usePluginStore.getState().credentials).toEqual({ 'org.example.a': { api: record } });
    const persisted = JSON.parse(mmkvStateStorage.getItem(PLUGIN_SETTINGS_KEY) as string) as {
      state: { credentials: unknown };
    };
    expect(persisted.state.credentials).toEqual({ 'org.example.a': { api: record } });
    usePluginStore.getState().removePlugin('org.example.a');
    expect(usePluginStore.getState().credentials).toEqual({});
  });

  it('restores well-formed records only', async () => {
    mmkvStateStorage.setItem(
      PLUGIN_SETTINGS_KEY,
      JSON.stringify({
        state: { credentials: { 'org.example.a': { api: record, broken: { secret: 'x' } }, 'org.example.b': 3 } },
        version: 0,
      }),
    );
    await usePluginStore.persist.rehydrate();
    expect(usePluginStore.getState().credentials).toEqual({ 'org.example.a': { api: record } });
  });
});
