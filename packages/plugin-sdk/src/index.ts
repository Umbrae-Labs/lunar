import type {
  CredentialStatus,
  JsonValue,
  PluginContext,
  PluginDefinition,
  ReaderEventName,
  ReaderEvents,
  ReaderSessionInfo,
  Theme,
  Translate,
} from './types.js';

export type * from './types.js';
export type {
  IconName,
  IconSpec,
  PackageIconPath,
  PluginComponentSlot,
  PluginIcon,
  PluginManifest,
  PluginSlot,
} from './manifest.js';

// Lunar supplies this module's runtime when it executes a plugin; plugin
// bundles keep `@umbrae-labs/lunar-plugin-sdk` external. The implementations below only
// exist so that importing the package outside Lunar fails loudly.

export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition;
}

function outsideHost(name: string): never {
  throw new Error(`${name} is only available while Lunar runs the plugin.`);
}

/** The context of the plugin that rendered the calling component. */
export function usePlugin(): PluginContext {
  return outsideHost('usePlugin');
}

/**
 * The current reading session. Pass a selector to re-render only when the
 * selected value changes; return primitives or existing objects from it.
 */
export function useReader(): ReaderSessionInfo | undefined;
export function useReader<T>(selector: (session: ReaderSessionInfo | undefined) => T): T;
export function useReader(): unknown {
  return outsideHost('useReader');
}

export function useReaderEvent<E extends ReaderEventName>(
  event: E,
  listener: (payload: ReaderEvents[E]) => void,
): void {
  void event;
  void listener;
  outsideHost('useReaderEvent');
}

export function useSetting<T extends JsonValue = JsonValue>(key: string): readonly [T, (value: T) => Promise<void>] {
  void key;
  return outsideHost('useSetting');
}

/** A persisted plugin value, its setter, and whether the first read has finished. */
export function useStorage<T extends JsonValue = JsonValue>(
  key: string,
): readonly [T | undefined, (value: T) => Promise<void>, boolean] {
  void key;
  return outsideHost('useStorage');
}

/** The status of a manifest credential; re-renders when the user changes it. */
export function useCredential(id: string): CredentialStatus {
  void id;
  return outsideHost('useCredential');
}

export function useTheme(): Theme {
  return outsideHost('useTheme');
}

export function useT(): Translate {
  return outsideHost('useT');
}
