import type { ComponentType } from 'react';
import type {
  CredentialsAPI,
  CredentialStatus,
  Disposable,
  HostInfo,
  JsonValue,
  LogAPI,
  MigrationContext,
  NetworkRequest,
  PluginContext,
  RouteProps,
  SettingsAPI,
  SlotProps,
  StorageAPI,
} from '@umbrae-labs/lunar-plugin-sdk';
import {
  hasNetworkAccess,
  hasPermission,
  SDK_VERSION,
  type PluginComponentSlot,
  type PluginCredentialContribution,
  type PluginSettingContribution,
} from '@umbrae-labs/lunar-plugin-sdk/manifest';

import { LunarPluginError } from '../domain/plugin-error';
import { credentialHeaders, credentialStatus } from './plugin-credentials';
import type { PluginGeneration } from './plugin-generation';
import type { PluginEntry, PluginHost } from './plugin-host';
import { pickMessages } from './plugin-locale';

/** Capabilities this host implements; plugins probe them through `ctx.host.capabilities`. */
export const HOST_CAPABILITIES: Readonly<Record<string, number>> = Object.freeze({
  commands: 1,
  'ui.panel': 1,
  'ui.overlay': 1,
  'ui.route': 1,
  'ui.settings': 1,
  'reader.events': 1,
  'reader.interceptors': 1,
  'reader.visibleText': 1,
  'reader.search': 1,
  'reader.navigate': 1,
  'reader.selection': 1,
  'reader.decorations': 1,
  settings: 1,
  storage: 1,
  network: 3,
  'network.stream': 1,
  credentials: 1,
  clipboard: 1,
  'library.import': 1,
  'ui.markdown': 1,
});

export const STORAGE_LIMITS = {
  keyLength: 200,
  valueBytes: 256 * 1024,
  totalBytes: 5 * 1024 * 1024,
} as const;

const ComponentSlots: readonly PluginComponentSlot[] = ['reader.panel', 'reader.overlay', 'settings.plugin'];

export function createPluginContext(host: PluginHost, entry: PluginEntry, generation: PluginGeneration): PluginContext {
  const plugin = entry.plugin;
  const manifest = plugin.manifest;
  const contributes = manifest.contributes;
  const live = () => generation.assertLive();
  const track = (cleanup: () => void) => generation.track(cleanup, () => host.notify());
  const declared = (ids: readonly { readonly id: string }[], id: string, kind: string) => {
    if (!ids.some((item) => item.id === id)) {
      throw new LunarPluginError('INVALID_ARGUMENT', `${kind} "${id}" is not declared in the manifest`);
    }
  };
  const registerComponent = (key: string, component: unknown) => {
    if (typeof component !== 'function' && (typeof component !== 'object' || component === null)) {
      throw new LunarPluginError('INVALID_ARGUMENT', 'A component must be a React component');
    }
    if (generation.components.has(key)) throw new LunarPluginError('INVALID_ARGUMENT', `${key} is already registered`);
    generation.components.set(key, component as ComponentType<never>);
    host.notify();
    return track(() => {
      generation.components.delete(key);
    });
  };
  const messages = () => pickMessages(plugin, host.deps.hostInfo().locale);
  /** Checks the network permission and resolves the header of the credential a request names. */
  const authorize = async (request: Pick<NetworkRequest, 'url' | 'credential'>) => {
    live();
    if (!hasNetworkAccess(manifest)) {
      throw new LunarPluginError('PERMISSION_DENIED', 'The manifest does not declare the network permission');
    }
    if (request.credential === undefined) return undefined;
    const headers = await credentialHeaders(
      host.deps.credentials,
      plugin.id,
      credentialDefinition(manifest.contributes.credentials, request.credential),
      request.url,
    );
    live();
    return headers;
  };

  const hostInfo: HostInfo = {
    sdkVersion: SDK_VERSION,
    capabilities: HOST_CAPABILITIES,
    get appVersion() {
      return host.deps.hostInfo().appVersion;
    },
    get platform() {
      return host.deps.hostInfo().platform;
    },
    get locale() {
      return host.deps.hostInfo().locale;
    },
    get colorScheme() {
      return host.deps.hostInfo().colorScheme;
    },
  };

  return {
    plugin: { id: plugin.id, version: plugin.version, generation: generation.number, source: plugin.source },
    host: hostInfo,
    subscriptions: [],

    commands: {
      register(id, handler) {
        live();
        declared(contributes.commands, id, 'Command');
        if (typeof handler !== 'function') throw new LunarPluginError('INVALID_ARGUMENT', 'handler must be a function');
        if (generation.commands.has(id))
          throw new LunarPluginError('INVALID_ARGUMENT', `Command ${id} is already registered`);
        generation.commands.set(id, handler);
        return track(() => {
          generation.commands.delete(id);
        });
      },
      async execute(id, args) {
        live();
        if (id.startsWith('lunar.')) {
          throw new LunarPluginError('CAPABILITY_UNAVAILABLE', `Host command ${id} is not available`);
        }
        declared(contributes.commands, id, 'Command');
        await host.executeCommand(plugin.id, id, 'plugin', args);
      },
    },

    ui: {
      registerSlot(slot, id, component) {
        live();
        if (!ComponentSlots.includes(slot))
          throw new LunarPluginError('INVALID_ARGUMENT', `${String(slot)} does not take components`);
        declared(contributes.slots[slot], id, `Slot entry ${slot}`);
        return registerComponent(`${slot}:${id}`, component as ComponentType<SlotProps>);
      },
      registerRoute(pageId, component) {
        live();
        declared(contributes.slots['app.route'], pageId, 'Route');
        return registerComponent(`route:${pageId}`, component as ComponentType<RouteProps>);
      },
      openPanel(id) {
        live();
        declared(contributes.slots['reader.panel'], id, 'Panel');
        host.reader.openPanel(entry, id);
      },
      closePanel(id) {
        live();
        if (id !== undefined) declared(contributes.slots['reader.panel'], id, 'Panel');
        host.reader.closePanel(entry, id);
      },
      openRoute(pageId, params = {}) {
        live();
        declared(contributes.slots['app.route'], pageId, 'Route');
        const entries = Object.entries(params);
        if (
          entries.length > 16 ||
          entries.some(([key, value]) => typeof value !== 'string' || key.length > 64 || value.length > 2_000)
        ) {
          throw new LunarPluginError('INVALID_ARGUMENT', 'Route parameters must be up to 16 short strings');
        }
        host.deps.ui.openRoute(plugin.id, pageId, Object.fromEntries(entries));
      },
      toast(message, tone = 'default') {
        live();
        host.deps.ui.toast(String(message).slice(0, 200), tone);
      },
      async confirm(options) {
        live();
        return host.deps.ui.confirm({
          title: String(options.title).slice(0, 120),
          message: options.message === undefined ? undefined : String(options.message).slice(0, 1_000),
          confirmLabel: options.confirmLabel?.slice(0, 40),
          cancelLabel: options.cancelLabel?.slice(0, 40),
          destructive: options.destructive === true,
        });
      },
    },

    reader: host.reader.createApi(entry, generation),

    settings: createPluginSettings(host, entry, live, track),

    storage: createPluginStorage(host, plugin.id, live),

    library: {
      async importEpub(input) {
        live();
        if (!hasPermission(manifest, 'library.import')) {
          throw new LunarPluginError('PERMISSION_DENIED', 'The library.import permission is required');
        }
        if (
          typeof input.fileName !== 'string' ||
          input.fileName.length === 0 ||
          input.fileName.length > 200 ||
          !input.fileName.toLowerCase().endsWith('.epub') ||
          !(input.bytes instanceof Uint8Array)
        ) {
          throw new LunarPluginError('INVALID_ARGUMENT', 'A valid EPUB file name and byte array are required');
        }
        if (input.bytes.byteLength > 100 * 1024 * 1024) {
          throw new LunarPluginError('QUOTA_EXCEEDED', 'The EPUB exceeds the 100 MiB import limit');
        }
        if (input.onProgress !== undefined && typeof input.onProgress !== 'function') {
          throw new LunarPluginError('INVALID_ARGUMENT', 'onProgress must be a function');
        }
        return host.deps.library.importEpub(input);
      },
    },

    network: {
      async request(request) {
        const headers = await authorize(request);
        return host.deps.network.request(plugin.id, request, generation.abort.signal, headers);
      },
      async stream(request) {
        const headers = await authorize(request);
        return host.deps.network.stream(plugin.id, request, generation.abort.signal, headers);
      },
    },

    credentials: createPluginCredentials(host, entry, live, track),

    services: {
      clipboard: {
        async setText(text) {
          live();
          if (typeof text !== 'string' || text.length > 100_000) {
            throw new LunarPluginError(
              'INVALID_ARGUMENT',
              'Clipboard text must be a string of up to 100000 characters',
            );
          }
          await host.deps.clipboard(text);
        },
      },
    },

    i18n: {
      get locale() {
        return host.deps.hostInfo().locale;
      },
      t: (key, params) => translate(messages(), key, params),
    },

    log: createPluginLog(host, entry),
  };
}

/** The context handed to `migrate`: data access only, before any registration exists. */
export function createMigrationContext(
  host: PluginHost,
  entry: PluginEntry,
  generation: PluginGeneration,
  from: number,
  to: number,
): MigrationContext {
  const plugin = entry.plugin;
  const live = () => generation.assertLive();
  return {
    plugin: { id: plugin.id, version: plugin.version, generation: generation.number, source: plugin.source },
    from,
    to,
    storage: createPluginStorage(host, plugin.id, live),
    settings: createPluginSettings(host, entry, live, (cleanup) => generation.track(cleanup, () => host.notify())),
    log: createPluginLog(host, entry),
  };
}

function createPluginSettings(
  host: PluginHost,
  entry: PluginEntry,
  live: () => void,
  track: (cleanup: () => void) => Disposable,
): SettingsAPI {
  const pluginId = entry.plugin.id;
  const definition = (key: string): PluginSettingContribution => {
    const found = entry.plugin.manifest.contributes.settings.find((item) => item.key === key);
    if (!found) throw new LunarPluginError('INVALID_ARGUMENT', `Setting "${key}" is not declared in the manifest`);
    return found;
  };
  // A value stored under an older manifest may no longer validate; the default replaces it.
  const read = (setting: PluginSettingContribution): JsonValue => {
    const stored = host.deps.settings.get(pluginId, setting.key);
    if (stored === undefined) return setting.default;
    try {
      return validateSetting(setting, stored);
    } catch {
      return setting.default;
    }
  };
  return {
    get<T extends JsonValue = JsonValue>(key: string): T {
      live();
      return read(definition(key)) as T;
    },
    async set(key, value) {
      live();
      host.deps.settings.set(pluginId, key, validateSetting(definition(key), value));
    },
    onChange(key, listener) {
      live();
      const setting = definition(key);
      let previous = read(setting);
      const unsubscribe = host.deps.settings.subscribe(() => {
        const next = read(setting);
        if (Object.is(next, previous)) return;
        previous = next;
        try {
          listener(next);
        } catch (error) {
          host.log(entry, 'error', `Setting listener failed: ${String(error)}`);
        }
      });
      return track(unsubscribe);
    },
  };
}

function credentialDefinition(
  credentials: readonly PluginCredentialContribution[],
  id: unknown,
): PluginCredentialContribution {
  const found = credentials.find((item) => item.id === id);
  if (!found)
    throw new LunarPluginError('INVALID_ARGUMENT', `Credential "${String(id)}" is not declared in the manifest`);
  return found;
}

function createPluginCredentials(
  host: PluginHost,
  entry: PluginEntry,
  live: () => void,
  track: (cleanup: () => void) => Disposable,
): CredentialsAPI {
  const pluginId = entry.plugin.id;
  const declared = entry.plugin.manifest.contributes.credentials;
  // Unchanged statuses keep their identity, so hooks can hand them to `useSyncExternalStore`.
  const cache = new Map<string, CredentialStatus>();
  const read = (id: string): CredentialStatus => {
    const next = credentialStatus(id, host.deps.credentials.get(pluginId, id));
    const previous = cache.get(id);
    if (previous && previous.configured === next.configured && previous.baseUrl === next.baseUrl) return previous;
    cache.set(id, next);
    return next;
  };
  return {
    get(id) {
      live();
      return read(credentialDefinition(declared, id).id);
    },
    onChange(id, listener) {
      live();
      const target = credentialDefinition(declared, id).id;
      let previous = read(target);
      const unsubscribe = host.deps.credentials.subscribe(() => {
        const next = read(target);
        if (next === previous) return;
        previous = next;
        try {
          listener(next);
        } catch (error) {
          host.log(entry, 'error', `Credential listener failed: ${String(error)}`);
        }
      });
      return track(unsubscribe);
    },
    async configure(id) {
      live();
      const target = credentialDefinition(declared, id).id;
      await host.deps.ui.configureCredential(pluginId, target);
      return read(target);
    },
  };
}

function createPluginLog(host: PluginHost, entry: PluginEntry): LogAPI {
  return {
    info: (message, ...details) => host.log(entry, 'info', formatLog(message, details)),
    warn: (message, ...details) => host.log(entry, 'warn', formatLog(message, details)),
    error: (message, ...details) => host.log(entry, 'error', formatLog(message, details)),
  };
}

/**
 * Plugin-private JSON storage. Writes of one plugin run one after another, so
 * `update` reads and writes without another write slipping in between.
 */
function createPluginStorage(host: PluginHost, pluginId: string, live: () => void): StorageAPI {
  const repository = host.deps.storage;
  const validKey = (key: unknown): string => {
    if (typeof key !== 'string' || key.length === 0 || key.length > STORAGE_LIMITS.keyLength) {
      throw new LunarPluginError('INVALID_ARGUMENT', 'Storage keys must be non-empty strings of up to 200 characters');
    }
    return key;
  };
  const read = async <T extends JsonValue>(key: string): Promise<T | undefined> => {
    const json = await repository.get(pluginId, key);
    return json === undefined ? undefined : (JSON.parse(json) as T);
  };
  const write = async (key: string, value: JsonValue) => {
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      json = undefined;
    }
    if (json === undefined) throw new LunarPluginError('INVALID_ARGUMENT', 'Storage values must be JSON');
    const size = utf8Length(json);
    if (size > STORAGE_LIMITS.valueBytes) throw new LunarPluginError('QUOTA_EXCEEDED', 'The value is too large');
    if ((await repository.totalBytes(pluginId, key)) + size > STORAGE_LIMITS.totalBytes) {
      throw new LunarPluginError('QUOTA_EXCEEDED', 'The plugin storage is full');
    }
    live();
    await repository.set(pluginId, key, json, size);
  };
  const remove = async (key: string) => {
    live();
    await repository.delete(pluginId, key);
  };

  return {
    async get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined> {
      live();
      return read<T>(validKey(key));
    },
    async set(key, value) {
      live();
      const target = validKey(key);
      await host.serializeStorage(pluginId, () => write(target, value));
      host.emitStorageChange(pluginId, target);
    },
    async update<T extends JsonValue = JsonValue>(
      key: string,
      updater: (current: T | undefined) => T | undefined,
    ): Promise<T | undefined> {
      live();
      const target = validKey(key);
      if (typeof updater !== 'function') throw new LunarPluginError('INVALID_ARGUMENT', 'updater must be a function');
      let changed = false;
      const next = await host.serializeStorage(pluginId, async () => {
        const current = await read<T>(target);
        const value: unknown = updater(current);
        if (value instanceof Promise) {
          throw new LunarPluginError('INVALID_ARGUMENT', 'The storage updater must be synchronous');
        }
        if (value === current) return current;
        if (value === undefined) await remove(target);
        else await write(target, value as T);
        changed = true;
        return value as T | undefined;
      });
      if (changed) host.emitStorageChange(pluginId, target);
      return next;
    },
    async delete(key) {
      live();
      const target = validKey(key);
      await host.serializeStorage(pluginId, () => remove(target));
      host.emitStorageChange(pluginId, target);
    },
    async keys(prefix) {
      live();
      return repository.keys(pluginId, prefix);
    },
  };
}

export function translate(
  messages: Readonly<Record<string, string>> | undefined,
  key: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = messages?.[key] ?? key;
  return params
    ? template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) => String(params[name] ?? match))
    : template;
}

export function validateSetting(definition: PluginSettingContribution, value: JsonValue): JsonValue {
  const invalid = () => new LunarPluginError('INVALID_ARGUMENT', `Invalid value for setting "${definition.key}"`);
  switch (definition.type) {
    case 'boolean':
      if (typeof value !== 'boolean') throw invalid();
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid();
      if (
        (definition.min !== undefined && value < definition.min) ||
        (definition.max !== undefined && value > definition.max)
      ) {
        throw invalid();
      }
      return value;
    case 'string':
      if (typeof value !== 'string' || value.length > (definition.maxLength ?? 2_000)) throw invalid();
      return value;
    case 'select':
      if (typeof value !== 'string' || !definition.options.some((option) => option.value === value)) throw invalid();
      return value;
  }
}

function formatLog(message: string, details: readonly unknown[]): string {
  const rendered = details.map((detail) => {
    if (typeof detail === 'string') return detail;
    if (detail instanceof Error) return detail.message;
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  });
  return [String(message), ...rendered].join(' ');
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}
