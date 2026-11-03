import { createContext, useContext } from 'react';
import type { PluginContext } from '@umbrae-labs/lunar-plugin-sdk';

import type { PluginHost } from '../services/plugin-host';

export interface PluginScopeValue {
  readonly host: PluginHost;
  readonly pluginId: string;
  readonly context: PluginContext;
}

/** Identifies the plugin that owns the components below; SDK hooks resolve through it. */
export const PluginScopeContext = createContext<PluginScopeValue | undefined>(undefined);

export function usePluginScope(hook: string): PluginScopeValue {
  const scope = useContext(PluginScopeContext);
  if (!scope) throw new Error(`${hook} must be called from a component rendered by a plugin slot`);
  return scope;
}
