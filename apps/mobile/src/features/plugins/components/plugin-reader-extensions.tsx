import type { SelectionMenuItem, ToolbarItem } from '@umbrae-labs/lunar-plugin-sdk';

import type {
  ReaderExtensionContributions,
  ReaderExtensionHost,
  ReaderExtensionSelection,
  ReaderSelectionAction,
} from '@/features/reader';
import { i18n } from '@/i18n';
import { LunarPluginError, pluginErrorMessage } from '../domain/plugin-error';
import { pluginSymbolName } from '../domain/plugin-icons';
import type { PluginHost } from '../services/plugin-host';
import { pluginPanelKey } from '../services/plugin-reader-bridge';
import { PluginSlotView } from './plugin-slot-view';

/** Extension panels share the tab bar with five built-in tabs. */
export const MAX_EXTENSION_PANELS = 3;
export const MAX_TOOLBAR_ACTIONS = 2;

type SelectionPlanItem =
  | { readonly kind: 'builtin'; readonly key: string }
  | { readonly kind: 'plugin'; readonly pluginId: string; readonly item: SelectionMenuItem };

/** Presents enabled plugins to the reader through its extension contract. */
export function createPluginReaderExtensions(host: PluginHost): ReaderExtensionHost {
  let cache: { readonly version: number; readonly contributions: ReaderExtensionContributions } | undefined;
  let plan:
    | {
        readonly selection: ReaderExtensionSelection;
        readonly version: number;
        readonly builtinKey: string;
        readonly items: readonly SelectionPlanItem[];
      }
    | undefined;

  const getContributions = (): ReaderExtensionContributions => {
    const version = host.getVersion();
    if (cache?.version === version) return cache.contributions;
    const entries = host.enabledEntries();
    const book = host.reader.currentBook();

    const panels = entries
      .flatMap((entry) =>
        entry.plugin.manifest.contributes.slots['reader.panel'].map((panel) => {
          const pluginId = entry.plugin.id;
          const title = host.localize(pluginId, panel.title);
          return {
            key: pluginPanelKey(pluginId, panel.id),
            accessibilityLabel: title,
            name: pluginSymbolName(panel.icon),
            title,
            renderContent: ({ close }: { readonly close: () => void }) => (
              <PluginSlotView
                host={host}
                pluginId={pluginId}
                componentKey={`reader.panel:${panel.id}`}
                componentProps={{ slotId: panel.id, close }}
              />
            ),
          };
        }),
      )
      .slice(0, MAX_EXTENSION_PANELS);

    const commands = new Map<string, { readonly pluginId: string; readonly command: string }>();
    const toolbarItems: ToolbarItem[] = entries.flatMap((entry) =>
      entry.plugin.manifest.contributes.slots['reader.toolbar'].map((item) => {
        const pluginId = entry.plugin.id;
        const command = entry.plugin.manifest.contributes.commands.find((candidate) => candidate.id === item.command);
        const id = `${pluginId}:${item.id}`;
        commands.set(id, { pluginId, command: item.command });
        return {
          id,
          pluginId,
          title: host.localize(pluginId, item.title ?? command?.title ?? item.id),
          icon: item.icon ?? command?.icon,
        };
      }),
    );
    const toolbarActions = (book ? host.reader.runToolbarItems(toolbarItems, book) : toolbarItems)
      .slice(0, MAX_TOOLBAR_ACTIONS)
      .map((item) => {
        const target = commands.get(item.id)!;
        return {
          key: item.id,
          accessibilityLabel: item.title,
          name: pluginSymbolName(item.icon),
          onPress: () => void host.executeCommand(target.pluginId, target.command, 'toolbar'),
        };
      });

    const overlays = entries.flatMap((entry) =>
      entry.plugin.manifest.contributes.slots['reader.overlay'].map((overlay) => {
        const pluginId = entry.plugin.id;
        return {
          key: `${pluginId}:${overlay.id}`,
          render: () => (
            <PluginSlotView
              host={host}
              pluginId={pluginId}
              componentKey={`reader.overlay:${overlay.id}`}
              componentProps={{ slotId: overlay.id }}
              quiet
            />
          ),
        };
      }),
    );

    const contributions = { panels, toolbarActions, overlays, decorations: host.reader.getDecorations() };
    cache = { version, contributions };
    return contributions;
  };

  const planSelection = (builtin: readonly ReaderSelectionAction[], selection: ReaderExtensionSelection) => {
    const version = host.getVersion();
    const builtinKey = builtin.map((action) => action.key).join('\u0000');
    if (plan?.selection === selection && plan.version === version && plan.builtinKey === builtinKey) return plan.items;
    const book = host.reader.currentBook();
    const builtinItems: SelectionMenuItem[] = builtin.map((action) => ({
      id: `lunar.${action.key}`,
      title: action.label,
      builtin: true,
    }));
    const items: SelectionPlanItem[] = [];
    if (book) {
      const result = host.reader.runSelectionMenu(builtinItems, book);
      for (const item of result.items) {
        const pluginId = result.origins.get(item);
        if (item.builtin) items.push({ kind: 'builtin', key: item.id.slice('lunar.'.length) });
        else if (pluginId) items.push({ kind: 'plugin', pluginId, item });
      }
    } else {
      items.push(...builtin.map((action) => ({ kind: 'builtin' as const, key: action.key })));
    }
    plan = { selection, version, builtinKey, items };
    return items;
  };

  return {
    subscribe: host.subscribe,
    getContributions,
    resolveSelectionActions(builtin, selection) {
      const byKey = new Map(builtin.map((action) => [action.key, action]));
      return planSelection(builtin, selection).flatMap((entry): ReaderSelectionAction[] => {
        if (entry.kind === 'builtin') {
          const action = byKey.get(entry.key);
          return action ? [action] : [];
        }
        const { pluginId, item } = entry;
        return [
          {
            key: `plugin:${pluginId}:${item.id}`,
            label: item.title,
            name: pluginSymbolName(item.icon),
            onPress: () => {
              const plugin = host.getEntry(pluginId);
              try {
                item.onPress?.(host.reader.grantSelection(pluginId, selection));
              } catch (error) {
                if (error instanceof LunarPluginError && error.code === 'QUOTA_EXCEEDED') {
                  host.deps.ui.toast(i18n.t('plugins.selectionTooLong'), 'danger');
                } else if (plugin) {
                  host.log(plugin, 'error', `Selection action ${item.id} failed: ${pluginErrorMessage(error)}`);
                }
              }
            },
          },
        ];
      });
    },
    attachSession: (port, controls) => host.reader.attach(port, controls),
  };
}
