import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { fetch as expoFetch, type FetchRequestInit } from 'expo/fetch';
import { strFromU8 } from 'fflate';
import { Platform } from 'react-native';
import { Uniwind } from 'uniwind';

import { getLunarDatabase } from '@/db';
import { i18n } from '@/i18n';
import { usePluginStore } from '@/stores';
import type { InstalledPlugin, PluginNotice } from '../domain/installed-plugin';
import { LunarPluginError } from '../domain/plugin-error';
import {
  deletePluginFiles,
  listPluginDirectories,
  readPluginBytes,
  sha256Hex,
  writePluginFiles,
} from '../infrastructure/expo-plugin-files';
import { deletePluginSecret, readPluginSecret, writePluginSecret } from '../infrastructure/expo-plugin-credentials';
import { importPluginEpub } from '../infrastructure/expo-plugin-library';
import { SQLitePluginRecordRepository, SQLitePluginStorageRepository } from '../repositories/sqlite-plugin-repository';
import type { PluginStorageRepository } from '../repositories/plugin-repository';
import { planCredentialSave, type CredentialSavePlan } from '../services/plugin-credentials';
import { PluginDevSession, type DevSessionStatus } from '../services/plugin-dev-session';
import { PluginHost, type PluginUiBridge } from '../services/plugin-host';
import { PluginInstaller, type PluginInstallPreview } from '../services/plugin-installer';
import { createPluginNetwork, type FetchLike } from '../services/plugin-network';
import { verifyEd25519 } from '../services/plugin-signature';
import { createHostModules } from './host-modules';

export interface PluginRuntime {
  readonly host: PluginHost;
  /** Installs the app's toast, dialog and navigation hosts; returns a disconnect function. */
  connectUi(bridge: PluginUiBridge): () => void;
  /** Plugins stay paused for this launch because the last one crashed during activation or the user asked. */
  isSafeMode(): boolean;
  exitSafeMode(): void;
  start(): Promise<void>;
  reload(): Promise<void>;
  inspectPackage(archive: Uint8Array): Promise<PluginInstallPreview>;
  installPackage(preview: PluginInstallPreview, enable: boolean): Promise<'applied' | 'pending'>;
  uninstall(pluginId: string, keepData: boolean): Promise<void>;
  /** Opens the credential sheet; resolves once the user closes it. */
  configureCredential(pluginId: string, credentialId: string): Promise<void>;
  /** Stores the key in the secure store and the address in preferences, or reports why it cannot. */
  saveCredential(
    pluginId: string,
    credentialId: string,
    input: { readonly baseUrl: string; readonly secret: string },
  ): Promise<{ readonly ok: true } | Extract<CredentialSavePlan, { ok: false }>>;
  removeCredential(pluginId: string, credentialId: string): Promise<void>;
  connectDevServer(url: string): void;
  disconnectDevServer(): void;
  getDevStatus(): DevSessionStatus | undefined;
  subscribeDevStatus(listener: () => void): () => void;
}

let runtime: PluginRuntime | undefined;

// Expo's fetch delivers response bodies while they arrive and supports `redirect: 'error'`.
const streamingFetch: FetchLike = (url, init) =>
  expoFetch(url, init as FetchRequestInit) as unknown as Promise<Response>;

export function getPluginRuntime(): PluginRuntime {
  runtime ??= createPluginRuntime();
  return runtime;
}

function createPluginRuntime(): PluginRuntime {
  const store = usePluginStore;
  const initial = store.getState();
  // The plugin whose activation was cut short by the previous process ending.
  let interruptedPluginId = initial.activatingPluginId;
  let safeMode = Boolean(initial.activatingPluginId) || initial.safeModeRequested;
  if (safeMode) {
    initial.setActivatingPlugin(undefined);
    initial.setSafeModeRequested(false);
  }

  const disconnected: PluginUiBridge = {
    toast: () => undefined,
    confirm: async () => false,
    openRoute: () => undefined,
    configureCredential: async () => undefined,
  };
  let connectedUi = disconnected;
  const ui: PluginUiBridge = {
    toast: (message, tone) => connectedUi.toast(message, tone),
    confirm: (options) => connectedUi.confirm(options),
    openRoute: (pluginId, pageId, params) => connectedUi.openRoute(pluginId, pageId, params),
    configureCredential: (pluginId, credentialId) => connectedUi.configureCredential(pluginId, credentialId),
  };
  const storage = lazyStorage();
  const recordsPromise = getLunarDatabase().then((database) => new SQLitePluginRecordRepository(database));
  const installer = recordsPromise.then(
    (records) =>
      new PluginInstaller({
        records,
        storage,
        sha256: sha256Hex,
        // Adding a catalog is what makes its key trusted.
        trustedKeys: () =>
          store
            .getState()
            .catalogs.map((catalog) => ({ keyId: catalog.keyId, key: catalog.key, catalogName: catalog.name })),
        verify: verifyEd25519,
        files: { write: writePluginFiles, remove: deletePluginFiles },
      }),
  );

  let installed: readonly InstalledPlugin[] = [];
  let devPlugin: InstalledPlugin | undefined;
  let devSession: PluginDevSession | undefined;
  let devStatus: DevSessionStatus | undefined;
  const devListeners = new Set<() => void>();
  let started: Promise<void> | undefined;

  const replaceInstalled = (plugin: InstalledPlugin) => {
    installed = installed.map((item) => (item.id === plugin.id ? plugin : item));
  };

  const host = new PluginHost({
    modules: createHostModules(),
    readEntry: async (plugin) => {
      if (!plugin.directoryUri || !plugin.entrySha256) {
        throw new LunarPluginError('INTEGRITY_FAILED', 'The plugin has no installed entry');
      }
      const bytes = await readPluginBytes(plugin.directoryUri, 'main.js');
      if ((await sha256Hex(bytes)) !== plugin.entrySha256) {
        throw new LunarPluginError('INTEGRITY_FAILED', 'main.js changed after installation');
      }
      return strFromU8(bytes);
    },
    settings: {
      get: (pluginId, key) => store.getState().settings[pluginId]?.[key],
      set: (pluginId, key, value) => store.getState().setSetting(pluginId, key, value),
      subscribe: (listener) =>
        store.subscribe((state, previous) => {
          if (state.settings !== previous.settings) listener();
        }),
    },
    storage,
    network: createPluginNetwork((url, init) => fetch(url, init), streamingFetch),
    credentials: {
      get: (pluginId, credentialId) => store.getState().credentials[pluginId]?.[credentialId],
      subscribe: (listener) =>
        store.subscribe((state, previous) => {
          if (state.credentials !== previous.credentials) listener();
        }),
      readSecret: readPluginSecret,
    },
    library: { importEpub: importPluginEpub },
    clipboard: (text) => Clipboard.setStringAsync(text).then(() => undefined),
    ui,
    hostInfo: () => ({
      appVersion: Constants.expoConfig?.version ?? '0.0.0',
      platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android',
      locale: i18n.language,
      colorScheme: Uniwind.currentTheme === 'dark' ? 'dark' : 'light',
    }),
    markActivation: (pluginId) => store.getState().setActivatingPlugin(pluginId),
    updates: {
      async commit(plugin) {
        const committed = await (await installer).commit(plugin);
        replaceInstalled(committed);
        return committed;
      },
      async revert(plugin) {
        const restored = await (await installer).revert(plugin);
        if (restored) replaceInstalled(restored);
        return restored;
      },
    },
    onLog: (pluginId, entry) => {
      if (devPlugin?.id === pluginId) devSession?.sendLog(entry);
    },
    onAutoDisabled: (pluginId, reason) => {
      store.getState().setEnabled(pluginId, false);
      ui.toast(
        `${host.localize(pluginId, host.getEntry(pluginId)?.plugin.manifest.name ?? pluginId)}: ${reason}`,
        'danger',
      );
    },
    schedule: (task) => {
      const idle = (globalThis as { requestIdleCallback?: (task: () => void, options?: { timeout: number }) => void })
        .requestIdleCallback;
      if (idle) idle(task, { timeout: 250 });
      else setTimeout(task, 0);
    },
  });

  const sync = () => {
    const state = store.getState();
    const plugins = devPlugin ? [...installed.filter((plugin) => plugin.id !== devPlugin!.id), devPlugin] : installed;
    host.setPlugins(
      plugins.map((plugin) => ({
        plugin,
        // A live development build runs while connected; installed plugins follow the user's choice.
        enabled: !safeMode && (plugin.source === 'development' || state.enabled[plugin.id] === true),
      })),
      state.order,
    );
  };

  /**
   * An activation that never finished may have left a half-migrated store or a
   * broken update behind; both go back to the state before that activation.
   */
  const recoverInterruptedActivation = async (pluginId: string): Promise<PluginNotice | undefined> => {
    await storage.restoreSnapshot(pluginId);
    const plugin = installed.find((item) => item.id === pluginId);
    if (!plugin?.previous) return undefined;
    const restored = await (await installer).revert(plugin);
    if (!restored) return undefined;
    replaceInstalled(restored);
    return {
      kind: 'reverted',
      failedVersion: plugin.version,
      restoredVersion: restored.version,
      reason: 'The app closed while this version was starting',
    };
  };

  const reload = async () => {
    const records = await recordsPromise;
    installed = await records.list();
    let notice: PluginNotice | undefined;
    const interrupted = interruptedPluginId;
    if (interrupted) {
      interruptedPluginId = undefined;
      try {
        notice = await recoverInterruptedActivation(interrupted);
      } catch (error) {
        console.warn(`[plugins] Recovering ${interrupted} failed`, error);
      }
    }
    const known = new Set(installed.map((plugin) => plugin.id));
    const files = await installer;
    for (const directory of listPluginDirectories()) {
      if (!known.has(directory)) deletePluginFiles(directory);
    }
    for (const plugin of installed) files.cleanUp(plugin);
    sync();
    if (interrupted && notice) host.setNotice(interrupted, notice);
  };

  const setDevStatus = (status: DevSessionStatus | undefined) => {
    devStatus = status;
    for (const listener of [...devListeners]) listener();
  };

  return {
    host,
    connectUi(bridge) {
      connectedUi = bridge;
      return () => {
        if (connectedUi === bridge) connectedUi = disconnected;
      };
    },
    isSafeMode: () => safeMode,
    exitSafeMode() {
      safeMode = false;
      sync();
    },
    start() {
      started ??= (async () => {
        store.subscribe((state, previous) => {
          if (state.enabled !== previous.enabled || state.order !== previous.order) sync();
        });
        await reload();
      })();
      return started;
    },
    reload,
    async inspectPackage(archive) {
      return (await installer).inspect(archive);
    },
    async installPackage(preview, enable) {
      const plugin = await (await installer).install(preview);
      installed = [...installed.filter((item) => item.id !== plugin.id), plugin];
      if (enable) store.getState().setEnabled(plugin.id, true);
      sync();
      return host.hasPendingVersion(plugin.id) ? 'pending' : 'applied';
    },
    async uninstall(pluginId, keepData) {
      const credentialIds = new Set([
        ...Object.keys(store.getState().credentials[pluginId] ?? {}),
        ...(installed.find((plugin) => plugin.id === pluginId)?.manifest.contributes.credentials ?? []).map(
          (credential) => credential.id,
        ),
      ]);
      await host.removePlugin(pluginId);
      await (await installer).uninstall(pluginId, keepData);
      // Keys go with the plugin even when its data stays: they were entered for that plugin alone.
      await Promise.all([...credentialIds].map((id) => deletePluginSecret(pluginId, id).catch(() => undefined)));
      installed = installed.filter((plugin) => plugin.id !== pluginId);
      store.getState().removePlugin(pluginId);
      sync();
    },
    configureCredential: (pluginId, credentialId) => ui.configureCredential(pluginId, credentialId),
    async saveCredential(pluginId, credentialId, input) {
      const plan = planCredentialSave(store.getState().credentials[pluginId]?.[credentialId], input);
      if (!plan.ok) return plan;
      if (plan.secret) await writePluginSecret(pluginId, credentialId, plan.secret);
      store.getState().setCredential(pluginId, credentialId, { baseUrl: plan.baseUrl, updatedAt: Date.now() });
      return { ok: true };
    },
    async removeCredential(pluginId, credentialId) {
      store.getState().setCredential(pluginId, credentialId, undefined);
      await deletePluginSecret(pluginId, credentialId);
    },
    connectDevServer(url) {
      devSession?.stop();
      devSession = new PluginDevSession(url, {
        fetch: (target, init) => fetch(target, { cache: 'no-store', ...init } as RequestInit),
        locales: () => [i18n.language],
        onPlugin: (plugin) => {
          devPlugin = plugin;
          sync();
        },
        onStatus: setDevStatus,
        onStop: () => {
          devPlugin = undefined;
          sync();
        },
      });
      devSession.start();
    },
    disconnectDevServer() {
      devSession?.stop();
      devSession = undefined;
    },
    getDevStatus: () => devStatus,
    subscribeDevStatus(listener) {
      devListeners.add(listener);
      return () => {
        devListeners.delete(listener);
      };
    },
  };
}

/** Defers opening the database until a plugin first touches its storage. */
function lazyStorage(): PluginStorageRepository {
  let repository: Promise<SQLitePluginStorageRepository> | undefined;
  const get = () => (repository ??= getLunarDatabase().then((database) => new SQLitePluginStorageRepository(database)));
  return {
    get: async (pluginId, key) => (await get()).get(pluginId, key),
    set: async (pluginId, key, value, size) => (await get()).set(pluginId, key, value, size),
    delete: async (pluginId, key) => (await get()).delete(pluginId, key),
    keys: async (pluginId, prefix) => (await get()).keys(pluginId, prefix),
    totalBytes: async (pluginId, excluding) => (await get()).totalBytes(pluginId, excluding),
    clear: async (pluginId) => (await get()).clear(pluginId),
    getDataVersion: async (pluginId) => (await get()).getDataVersion(pluginId),
    setDataVersion: async (pluginId, version) => (await get()).setDataVersion(pluginId, version),
    snapshot: async (pluginId) => (await get()).snapshot(pluginId),
    restoreSnapshot: async (pluginId) => (await get()).restoreSnapshot(pluginId),
    dropSnapshot: async (pluginId) => (await get()).dropSnapshot(pluginId),
  };
}
