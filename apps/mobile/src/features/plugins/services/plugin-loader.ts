import type { PluginDefinition } from '@umbrae-labs/lunar-plugin-sdk';
import { LunarPluginError } from '../domain/plugin-error';

export type PluginRequire = (name: string) => unknown;

/** A `require` that resolves only the modules the host chose to share. */
export function createPluginRequire(modules: Readonly<Record<string, unknown>>): PluginRequire {
  return (name) => {
    if (!Object.prototype.hasOwnProperty.call(modules, name)) {
      throw new LunarPluginError('MODULE_NOT_FOUND', `Module "${name}" is not provided by Lunar`);
    }
    return modules[name];
  };
}

/**
 * Executes a verified CommonJS entry and returns its plugin definition.
 * The entry shares this JavaScript environment; see the trust model in the
 * plugin SDK design before relaxing what reaches this function.
 */
export function evaluatePluginEntry(source: string, require: PluginRequire, sourceUrl: string): PluginDefinition {
  const module: { exports: unknown } = { exports: {} };
  const factory = new Function('require', 'module', 'exports', `${source}\n//# sourceURL=${sourceUrl}`) as (
    require: PluginRequire,
    module: { exports: unknown },
    exports: unknown,
  ) => void;
  factory(require, module, module.exports);

  const exported = module.exports as { __esModule?: boolean; default?: unknown } | undefined;
  const definition = (exported && 'default' in exported ? exported.default : exported) as
    Partial<PluginDefinition> | undefined;
  if (!definition || typeof definition.activate !== 'function') {
    throw new LunarPluginError('INVALID_ARGUMENT', 'The entry must export a plugin definition with activate()');
  }
  if (definition.deactivate !== undefined && typeof definition.deactivate !== 'function') {
    throw new LunarPluginError('INVALID_ARGUMENT', 'deactivate must be a function');
  }
  return definition as PluginDefinition;
}
