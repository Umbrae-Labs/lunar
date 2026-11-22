import { BottomSheet } from 'heroui-native/bottom-sheet';
import { Button } from 'heroui-native/button';
import { useBottomSheetAwareHandlers } from 'heroui-native/hooks';
import { Input } from 'heroui-native/input';
import { Label } from 'heroui-native/label';
import { TextField } from 'heroui-native/text-field';
import { useToast } from 'heroui-native/toast';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';
import { usePluginStore } from '@/stores';
import type { PluginRuntime } from '../runtime/plugin-runtime';

export interface PluginCredentialTarget {
  readonly pluginId: string;
  readonly credentialId: string;
}

interface PluginCredentialSheetProps {
  readonly runtime: PluginRuntime;
  readonly target?: PluginCredentialTarget;
  readonly onClose: () => void;
}

/** Host-owned form for a plugin's service key; the plugin only learns whether one is set. */
export function PluginCredentialSheet({ runtime, target, onClose }: PluginCredentialSheetProps) {
  const insets = useSafeAreaInsets();
  // The form stays mounted through the closing animation.
  const [shown, setShown] = useState(target);
  if (target && target !== shown) setShown(target);

  return (
    <BottomSheet isOpen={Boolean(target)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          backgroundClassName="rounded-t-3xl"
          bottomInset={insets.bottom}
          contentContainerClassName="gap-4 px-5 pb-6"
          enableOverDrag={false}>
          {shown ? (
            <CredentialForm
              key={`${shown.pluginId}\u0000${shown.credentialId}`}
              runtime={runtime}
              target={shown}
              onDone={onClose}
            />
          ) : null}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}

function CredentialForm({
  runtime,
  target,
  onDone,
}: {
  readonly runtime: PluginRuntime;
  readonly target: PluginCredentialTarget;
  readonly onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { onFocus, onBlur } = useBottomSheetAwareHandlers();
  const { pluginId, credentialId } = target;
  const host = runtime.host;
  const plugin = host.getEntry(pluginId)?.plugin;
  const definition = plugin?.manifest.contributes.credentials.find((item) => item.id === credentialId);
  const stored = usePluginStore((state) => state.credentials[pluginId]?.[credentialId]);
  const [baseUrl, setBaseUrl] = useState(stored?.baseUrl ?? definition?.baseUrl ?? '');
  const [secret, setSecret] = useState('');
  const [problem, setProblem] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  if (!plugin || !definition) return null;
  const text = (value: string) => host.localize(pluginId, value);

  const save = async () => {
    setIsSaving(true);
    try {
      const result = await runtime.saveCredential(pluginId, credentialId, { baseUrl, secret });
      if (!result.ok) {
        setProblem(
          t(
            result.problem === 'invalidUrl'
              ? 'plugins.credentialInvalidUrl'
              : result.problem === 'secretRequired'
                ? 'plugins.credentialSecretRequired'
                : 'plugins.credentialInvalidSecret',
          ),
        );
        return;
      }
      toast.show({ variant: 'success', label: t('plugins.credentialSaved') });
      onDone();
    } catch {
      toast.show({ variant: 'danger', label: t('plugins.credentialSaveFailed') });
    } finally {
      setIsSaving(false);
    }
  };
  const remove = async () => {
    setIsSaving(true);
    try {
      await runtime.removeCredential(pluginId, credentialId);
      toast.show({ variant: 'default', label: t('plugins.credentialRemoved') });
      onDone();
    } catch {
      toast.show({ variant: 'danger', label: t('plugins.credentialSaveFailed') });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <BottomSheet.Title className="text-xl text-foreground">{text(definition.title)}</BottomSheet.Title>
      {definition.description ? (
        <Text className="text-sm leading-5 text-muted">{text(definition.description)}</Text>
      ) : null}
      <Text className="text-sm leading-5 text-muted">
        {t('plugins.credentialIntro', { plugin: text(plugin.manifest.name) })}
      </Text>
      <TextField isDisabled={isSaving}>
        <Label>{t('plugins.credentialBaseUrl')}</Label>
        <Input
          value={baseUrl}
          onChangeText={(value) => {
            setBaseUrl(value);
            setProblem(undefined);
          }}
          placeholder="https://"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onFocus={onFocus}
          onBlur={onBlur}
          accessibilityLabel={t('plugins.credentialBaseUrl')}
        />
      </TextField>
      <TextField isDisabled={isSaving}>
        <Label>{t('plugins.credentialSecret')}</Label>
        <Input
          value={secret}
          onChangeText={(value) => {
            setSecret(value);
            setProblem(undefined);
          }}
          placeholder={t(stored ? 'plugins.credentialSecretKeep' : 'plugins.credentialSecretPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          textContentType="password"
          importantForAutofill="no"
          onFocus={onFocus}
          onBlur={onBlur}
          accessibilityLabel={t('plugins.credentialSecret')}
        />
      </TextField>
      {problem ? <Text className="text-sm text-danger">{problem}</Text> : null}
      <View className="flex-row gap-3">
        {stored ? (
          <Button className="flex-1" variant="danger-soft" isDisabled={isSaving} onPress={() => void remove()}>
            {t('plugins.credentialRemove')}
          </Button>
        ) : (
          <Button className="flex-1" variant="tertiary" isDisabled={isSaving} onPress={onDone}>
            {t('action.cancel')}
          </Button>
        )}
        <Button
          className="flex-1"
          variant="primary"
          isDisabled={isSaving || !baseUrl.trim()}
          onPress={() => void save()}>
          {t('plugins.credentialSave')}
        </Button>
      </View>
    </>
  );
}
