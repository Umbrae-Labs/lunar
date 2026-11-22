import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from 'heroui-native/button';
import { useThemeColor } from 'heroui-native/hooks';
import { Input } from 'heroui-native/input';
import { Label } from 'heroui-native/label';
import { Surface } from 'heroui-native/surface';
import { useToast } from 'heroui-native/toast';
import { startTransition, useCallback, useEffect, useState, useTransition } from 'react';
import { Text, View } from 'react-native';

import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Icon } from '@/components/ui/icon';
import { useTranslation } from '@/i18n';
import { usePluginStore, type PluginCatalogSubscription } from '@/stores';
import { pluginErrorMessage } from '../domain/plugin-error';
import { inspectPluginCatalog, usePluginCatalogs } from '../hooks/use-plugin-catalogs';
import { normalizeCatalogUrl, type FetchedCatalog } from '../services/plugin-catalog';
import type { CatalogStatus } from '../services/plugin-catalog-cache';

/**
 * The plugin settings section that adds and removes catalogs. Adding one trusts its signing key
 * for the packages it publishes.
 */
export function PluginCatalogSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { toast } = useToast();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const { subscriptions, statuses } = usePluginCatalogs();
  const addCatalog = usePluginStore((state) => state.addCatalog);
  const removeCatalog = usePluginStore((state) => state.removeCatalog);
  // A catalog link fills in the address it carries.
  const [url, setUrl] = useState(() => add ?? '');
  const [isChecking, startChecking] = useTransition();
  const [pending, setPending] = useState<FetchedCatalog>();
  const [removing, setRemoving] = useState<PluginCatalogSubscription>();
  const replaced = pending ? subscriptions.find((catalog) => catalog.url === pending.url) : undefined;

  const check = useCallback(
    (address: string) => {
      const normalized = normalizeCatalogUrl(address);
      if (!normalized) {
        toast.show({ variant: 'danger', label: t('plugins.catalog.httpsOnly') });
        return;
      }
      startChecking(async () => {
        try {
          const fetched = await inspectPluginCatalog(normalized);
          startTransition(() => setPending(fetched));
        } catch (error) {
          toast.show({ variant: 'danger', label: pluginErrorMessage(error) });
        }
      });
    },
    [t, toast],
  );

  // `lunar://add-catalog?url=…` links arrive as `?add=<url>`.
  useEffect(() => {
    if (!add) return;
    router.setParams({ add: undefined });
    check(add);
  }, [add, check, router]);

  const confirmAdd = () => {
    if (!pending) return;
    const { name, badge, website, signingKey } = pending.catalog;
    addCatalog({ url: pending.url, name, badge, website, keyId: pending.keyId, key: signingKey, addedAt: Date.now() });
    setPending(undefined);
    setUrl('');
    toast.show({ variant: 'success', label: t('plugins.catalog.added', { name }) });
  };

  return (
    <View className="gap-2">
      <Text className="ml-3 text-sm font-medium text-muted">{t('plugins.catalog.manage')}</Text>
      {/* A Surface, like the ListGroup around the developer server field, gives the input its on-surface colors. */}
      <Surface className="gap-3 rounded-3xl p-5">
        <Label>{t('plugins.catalog.address')}</Label>
        <Input
          value={url}
          onChangeText={setUrl}
          placeholder="https://example.com/lunar/index.json"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel={t('plugins.catalog.address')}
          onSubmitEditing={() => check(url)}
        />
        <Text className="text-sm leading-5 text-muted">{t('plugins.catalog.addressHint')}</Text>
        <Button variant="primary" isDisabled={!url.trim() || isChecking} onPress={() => check(url)}>
          {isChecking ? t('plugins.catalog.checking') : t('plugins.catalog.add')}
        </Button>
      </Surface>

      {subscriptions.length > 0 ? (
        <View className="gap-1 overflow-hidden rounded-3xl bg-surface">
          {subscriptions.map((catalog) => (
            <CatalogRow
              key={catalog.url}
              catalog={catalog}
              status={statuses.get(catalog.url)}
              onRemove={() => setRemoving(catalog)}
            />
          ))}
        </View>
      ) : null}

      <ConfirmModal
        isOpen={Boolean(pending)}
        title={t('plugins.catalog.confirmTitle', { name: pending?.catalog.name ?? '' })}
        description={
          pending
            ? [
                t(
                  replaced && replaced.keyId !== pending.keyId
                    ? 'plugins.catalog.replaceKeyBody'
                    : 'plugins.catalog.confirmBody',
                ),
                pending.url,
                pending.catalog.website,
                t('plugins.catalog.pluginCount', { count: String(pending.catalog.plugins.length) }),
                t('plugins.catalog.keyLabel', { key: pending.keyId }),
              ]
                .filter(Boolean)
                .join('\n')
            : undefined
        }
        confirmLabel={t('plugins.catalog.trust')}
        onConfirm={confirmAdd}
        onOpenChange={(open) => {
          if (!open) setPending(undefined);
        }}
      />
      <ConfirmModal
        isOpen={Boolean(removing)}
        title={t('plugins.catalog.removeTitle', { name: removing?.name ?? '' })}
        description={t('plugins.catalog.removeBody')}
        confirmLabel={t('plugins.catalog.remove')}
        isDestructive
        onConfirm={() => {
          if (removing) removeCatalog(removing.url);
          setRemoving(undefined);
        }}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
      />
    </View>
  );
}

function CatalogRow({
  catalog,
  status,
  onRemove,
}: {
  readonly catalog: PluginCatalogSubscription;
  readonly status?: CatalogStatus;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation();
  const danger = useThemeColor('danger');
  const state =
    status?.state === 'failed'
      ? status.keyChanged
        ? t('plugins.catalog.keyChanged')
        : status.error
      : status?.state === 'ready'
        ? t('plugins.catalog.pluginCount', { count: String(status.fetched.catalog.plugins.length) })
        : t('plugins.catalog.checking');

  return (
    <View className="flex-row items-center gap-3 px-5 py-4">
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-base font-medium text-foreground" numberOfLines={1}>
          {catalog.badge ? `${catalog.name} · ${catalog.badge}` : catalog.name}
        </Text>
        <Text selectable className="text-xs leading-4 text-muted" numberOfLines={1}>
          {catalog.url}
        </Text>
        <Text selectable className="text-xs leading-4 text-muted" numberOfLines={1}>
          {t('plugins.catalog.keyLabel', { key: catalog.keyId })}
        </Text>
        <Text
          className={`text-xs leading-4 ${status?.state === 'failed' ? 'text-danger' : 'text-muted'}`}
          numberOfLines={2}>
          {state}
        </Text>
      </View>
      <Button
        isIconOnly
        accessibilityLabel={t('plugins.catalog.removeTitle', { name: catalog.name })}
        className="size-11 rounded-full"
        variant="ghost"
        onPress={onRemove}>
        <Icon name="delete" size={20} color={danger} />
      </Button>
    </View>
  );
}
