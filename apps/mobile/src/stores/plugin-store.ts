import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStateStorage } from './mmkv-state-storage';

/** A JSON-compatible value that a plugin setting can hold. */
export type PluginSettingValue =
  string | number | boolean | null | PluginSettingValue[] | { [key: string]: PluginSettingValue };

/** A plugin catalog the user added, with the signing key pinned when it was added. */
export interface PluginCatalogSubscription {
  /** HTTPS URL of the catalog index. */
  readonly url: string;
  readonly name: string;
  readonly badge?: string;
  readonly website?: string;
  /** JWK thumbprint (RFC 7638) of `key`. */
  readonly keyId: string;
  /** Ed25519 public key as a JSON Web Key (RFC 8037). */
  readonly key: { readonly kty: 'OKP'; readonly crv: 'Ed25519'; readonly x: string };
  readonly addedAt: number;
}

/** A credential the user set up; the key itself lives in the platform's secure store. */
export interface PluginCredentialPreference {
  /** HTTPS address the key may be sent to. */
  readonly baseUrl: string;
  readonly updatedAt: number;
}

/** How many plugin entries the app's bottom navigation holds next to the built-in tabs. */
export const MAX_PLUGIN_TABS = 2;

interface PluginStoreState {
  /** Plugins the user enabled; absent means disabled. */
  readonly enabled: Readonly<Record<string, boolean>>;
  /** User-chosen order of plugin entries in shared extension points. */
  readonly order: readonly string[];
  /** Plugins the user pinned to the bottom navigation, in tab order. */
  readonly tabs: readonly string[];
  /** Catalogs the user added, in the order they were added. Lunar ships with none. */
  readonly catalogs: readonly PluginCatalogSubscription[];
  readonly settings: Readonly<Record<string, Readonly<Record<string, PluginSettingValue>>>>;
  /** Configured credentials by plugin and credential id. */
  readonly credentials: Readonly<Record<string, Readonly<Record<string, PluginCredentialPreference>>>>;
  readonly developerMode: boolean;
  /**
   * The plugin whose activation was in progress when the app last stopped.
   * A value that survives a restart means activation crashed the app.
   */
  readonly activatingPluginId?: string;
  /** Start the next launch with every plugin paused. */
  readonly safeModeRequested: boolean;
  setEnabled(pluginId: string, enabled: boolean): void;
  setSetting(pluginId: string, key: string, value: PluginSettingValue): void;
  /** Records or, with `undefined`, forgets a credential; the secure store holds its key. */
  setCredential(pluginId: string, credentialId: string, credential: PluginCredentialPreference | undefined): void;
  /** Pinning past `MAX_PLUGIN_TABS` is ignored. */
  setTabPinned(pluginId: string, pinned: boolean): void;
  /** Adds the catalog, replacing an entry with the same URL. */
  addCatalog(catalog: PluginCatalogSubscription): void;
  /** Refreshes the descriptive fields; the URL and key stay as they were added. */
  updateCatalog(url: string, details: Pick<PluginCatalogSubscription, 'name' | 'badge' | 'website'>): void;
  removeCatalog(url: string): void;
  setDeveloperMode(enabled: boolean): void;
  setActivatingPlugin(pluginId: string | undefined): void;
  setSafeModeRequested(requested: boolean): void;
  /** Forgets the plugin's preferences when it is uninstalled. */
  removePlugin(pluginId: string): void;
}

type PersistedPluginPreferences = Pick<
  PluginStoreState,
  | 'enabled'
  | 'order'
  | 'tabs'
  | 'catalogs'
  | 'settings'
  | 'credentials'
  | 'developerMode'
  | 'activatingPluginId'
  | 'safeModeRequested'
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCatalog(value: unknown): PluginCatalogSubscription | undefined {
  if (!isRecord(value) || !isRecord(value.key)) return undefined;
  const { url, name, badge, website, keyId, key, addedAt } = value;
  if (
    typeof url !== 'string' ||
    typeof name !== 'string' ||
    typeof keyId !== 'string' ||
    key.kty !== 'OKP' ||
    key.crv !== 'Ed25519' ||
    typeof key.x !== 'string'
  ) {
    return undefined;
  }
  return {
    url,
    name,
    badge: typeof badge === 'string' ? badge : undefined,
    website: typeof website === 'string' ? website : undefined,
    keyId,
    key: { kty: 'OKP', crv: 'Ed25519', x: key.x },
    addedAt: typeof addedAt === 'number' ? addedAt : 0,
  };
}

function normalizeCredentials(value: unknown): Record<string, Record<string, PluginCredentialPreference>> {
  if (!isRecord(value)) return {};
  const result: Record<string, Record<string, PluginCredentialPreference>> = {};
  for (const [pluginId, credentials] of Object.entries(value)) {
    if (!isRecord(credentials)) continue;
    const entries = Object.entries(credentials).flatMap(([id, item]) =>
      isRecord(item) && typeof item.baseUrl === 'string'
        ? [[id, { baseUrl: item.baseUrl, updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0 }] as const]
        : [],
    );
    if (entries.length > 0) result[pluginId] = Object.fromEntries(entries);
  }
  return result;
}

function normalizePersisted(value: unknown): Partial<PersistedPluginPreferences> {
  if (!isRecord(value)) return {};
  const enabled = isRecord(value.enabled)
    ? Object.fromEntries(Object.entries(value.enabled).filter(([, item]) => item === true))
    : {};
  const order = Array.isArray(value.order)
    ? value.order.filter((item): item is string => typeof item === 'string')
    : [];
  const tabs = Array.isArray(value.tabs)
    ? [...new Set(value.tabs.filter((item): item is string => typeof item === 'string'))].slice(0, MAX_PLUGIN_TABS)
    : [];
  const catalogs = Array.isArray(value.catalogs) ? value.catalogs.flatMap((item) => normalizeCatalog(item) ?? []) : [];
  const settings = isRecord(value.settings)
    ? (Object.fromEntries(Object.entries(value.settings).filter(([, item]) => isRecord(item))) as Record<
        string,
        Record<string, PluginSettingValue>
      >)
    : {};
  return {
    enabled: enabled as Record<string, boolean>,
    order,
    tabs,
    catalogs: catalogs.filter((item, index) => catalogs.findIndex((other) => other.url === item.url) === index),
    settings,
    credentials: normalizeCredentials(value.credentials),
    developerMode: value.developerMode === true,
    activatingPluginId: typeof value.activatingPluginId === 'string' ? value.activatingPluginId : undefined,
    safeModeRequested: value.safeModeRequested === true,
  };
}

export const usePluginStore = create<PluginStoreState>()(
  persist<PluginStoreState, [], [], PersistedPluginPreferences>(
    (set) => ({
      enabled: {},
      order: [],
      tabs: [],
      catalogs: [],
      settings: {},
      credentials: {},
      developerMode: false,
      safeModeRequested: false,
      setEnabled: (pluginId, enabled) =>
        set((state) => {
          const next = { ...state.enabled };
          if (enabled) next[pluginId] = true;
          else delete next[pluginId];
          return {
            enabled: next,
            order: state.order.includes(pluginId) ? state.order : [...state.order, pluginId],
          };
        }),
      setSetting: (pluginId, key, value) =>
        set((state) => ({
          settings: { ...state.settings, [pluginId]: { ...state.settings[pluginId], [key]: value } },
        })),
      setCredential: (pluginId, credentialId, credential) =>
        set((state) => {
          const owned = { ...state.credentials[pluginId] };
          if (credential) owned[credentialId] = credential;
          else delete owned[credentialId];
          const credentials = { ...state.credentials, [pluginId]: owned };
          if (Object.keys(owned).length === 0) delete credentials[pluginId];
          return { credentials };
        }),
      setTabPinned: (pluginId, pinned) =>
        set((state) => {
          const included = state.tabs.includes(pluginId);
          if (pinned === included || (pinned && state.tabs.length >= MAX_PLUGIN_TABS)) return state;
          return { tabs: pinned ? [...state.tabs, pluginId] : state.tabs.filter((item) => item !== pluginId) };
        }),
      addCatalog: (catalog) =>
        set((state) => ({ catalogs: [...state.catalogs.filter((item) => item.url !== catalog.url), catalog] })),
      updateCatalog: (url, details) =>
        set((state) => ({
          catalogs: state.catalogs.map((item) =>
            item.url === url ? { ...item, name: details.name, badge: details.badge, website: details.website } : item,
          ),
        })),
      removeCatalog: (url) => set((state) => ({ catalogs: state.catalogs.filter((item) => item.url !== url) })),
      setDeveloperMode: (developerMode) => set({ developerMode }),
      setActivatingPlugin: (activatingPluginId) => set({ activatingPluginId }),
      setSafeModeRequested: (safeModeRequested) => set({ safeModeRequested }),
      removePlugin: (pluginId) =>
        set((state) => {
          const enabled = { ...state.enabled };
          const settings = { ...state.settings };
          const credentials = { ...state.credentials };
          delete enabled[pluginId];
          delete settings[pluginId];
          delete credentials[pluginId];
          return {
            enabled,
            settings,
            credentials,
            order: state.order.filter((item) => item !== pluginId),
            tabs: state.tabs.filter((item) => item !== pluginId),
          };
        }),
    }),
    {
      name: 'settings.plugins',
      storage: createJSONStorage(() => mmkvStateStorage),
      partialize: ({
        enabled,
        order,
        tabs,
        catalogs,
        settings,
        credentials,
        developerMode,
        activatingPluginId,
        safeModeRequested,
      }) => ({
        enabled,
        order,
        tabs,
        catalogs,
        settings,
        credentials,
        developerMode,
        activatingPluginId,
        safeModeRequested,
      }),
      merge: (persisted, current) => ({ ...current, ...normalizePersisted(persisted) }),
    },
  ),
);
