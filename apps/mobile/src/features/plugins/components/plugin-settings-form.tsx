import type { JsonValue } from '@umbrae-labs/lunar-plugin-sdk';
import type { PluginSettingContribution } from '@umbrae-labs/lunar-plugin-sdk/manifest';

import { useTranslation } from '@/i18n';
import { usePluginStore } from '@/stores';
import type { InstalledPlugin } from '../domain/installed-plugin';
import { uiModule as Ui } from '../runtime/ui-module';
import type { PluginHost } from '../services/plugin-host';
import { validateSetting } from '../services/plugin-context';

interface PluginSettingsFormProps {
  readonly host: PluginHost;
  readonly plugin: InstalledPlugin;
}

/** Edits the settings a manifest declares; values are validated before they are stored. */
export function PluginSettingsForm({ host, plugin }: PluginSettingsFormProps) {
  const values = usePluginStore((state) => state.settings[plugin.id]);
  const setSetting = usePluginStore((state) => state.setSetting);
  const settings = plugin.manifest.contributes.settings;
  if (settings.length === 0) return null;
  const text = (value: string) => host.localize(plugin.id, value);
  const update = (definition: PluginSettingContribution, value: JsonValue) => {
    try {
      setSetting(plugin.id, definition.key, validateSetting(definition, value));
    } catch {
      // Out-of-range input is ignored; the control keeps showing the stored value.
    }
  };

  return (
    <Ui.Stack gap="md">
      {settings.map((definition) => {
        const value = values?.[definition.key] ?? definition.default;
        const title = text(definition.title);
        const description = definition.description ? text(definition.description) : undefined;
        switch (definition.type) {
          case 'boolean':
            return (
              <Ui.Switch
                key={definition.key}
                label={title}
                description={description}
                value={value === true}
                onValueChange={(next) => update(definition, next)}
              />
            );
          case 'number':
            return (
              <NumberSetting
                key={definition.key}
                definition={definition}
                title={title}
                description={description}
                value={typeof value === 'number' ? value : definition.default}
                onChange={(next) => update(definition, next)}
              />
            );
          case 'string':
            return (
              <Ui.TextField
                key={definition.key}
                label={title}
                description={description}
                value={typeof value === 'string' ? value : definition.default}
                onChangeText={(next) => update(definition, next)}
              />
            );
          case 'select':
            return (
              <Ui.Stack key={definition.key} gap="sm">
                <Ui.Text weight="medium">{title}</Ui.Text>
                {description ? (
                  <Ui.Text size="sm" tone="muted">
                    {description}
                  </Ui.Text>
                ) : null}
                <Ui.List>
                  {definition.options.map((option) => (
                    <Ui.ListItem
                      key={option.value}
                      title={text(option.label)}
                      onPress={() => update(definition, option.value)}
                      trailing={
                        option.value === value ? (
                          <Ui.Icon name={{ ios: 'checkmark', android: 'check' }} tone="accent" />
                        ) : undefined
                      }
                    />
                  ))}
                </Ui.List>
              </Ui.Stack>
            );
        }
      })}
    </Ui.Stack>
  );
}

function NumberSetting({
  definition,
  title,
  description,
  value,
  onChange,
}: {
  readonly definition: Extract<PluginSettingContribution, { type: 'number' }>;
  readonly title: string;
  readonly description?: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const { t } = useTranslation();
  const step = definition.step ?? 1;
  const clamp = (next: number) =>
    Math.min(definition.max ?? Number.POSITIVE_INFINITY, Math.max(definition.min ?? Number.NEGATIVE_INFINITY, next));
  // Round to the step's precision so repeated presses do not accumulate floating-point error.
  const precision = (String(step).split('.')[1] ?? '').length;
  const adjust = (direction: -1 | 1) => onChange(clamp(Number((value + direction * step).toFixed(precision))));

  return (
    <Ui.Row gap="md" justify="between">
      <Ui.Stack gap="xs" style={{ flex: 1 }}>
        <Ui.Text weight="medium">{title}</Ui.Text>
        {description ? (
          <Ui.Text size="sm" tone="muted">
            {description}
          </Ui.Text>
        ) : null}
      </Ui.Stack>
      <Ui.Row gap="xs">
        <Ui.IconButton
          icon={{ ios: 'minus', android: 'remove' }}
          accessibilityLabel={t('plugins.decrease', { title })}
          disabled={definition.min !== undefined && value <= definition.min}
          onPress={() => adjust(-1)}
        />
        <Ui.Text weight="semibold">{String(value)}</Ui.Text>
        <Ui.IconButton
          icon={{ ios: 'plus', android: 'add' }}
          accessibilityLabel={t('plugins.increase', { title })}
          disabled={definition.max !== undefined && value >= definition.max}
          onPress={() => adjust(1)}
        />
      </Ui.Row>
    </Ui.Row>
  );
}
