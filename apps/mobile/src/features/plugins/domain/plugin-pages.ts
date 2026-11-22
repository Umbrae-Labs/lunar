import type { PluginManifest, PluginRouteContribution } from '@umbrae-labs/lunar-plugin-sdk/manifest';

/** Routes the plugin offers as entry pages; hidden routes are only navigation targets. */
export function pluginEntryRoutes(manifest: PluginManifest): readonly PluginRouteContribution[] {
  return manifest.contributes.slots['app.route'].filter((route) => !route.hidden);
}
