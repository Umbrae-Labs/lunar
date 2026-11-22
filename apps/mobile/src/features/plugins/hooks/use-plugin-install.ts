import { useToast } from 'heroui-native/toast';
import { useCallback, useState } from 'react';

import { useTranslation } from '@/i18n';
import { usePluginStore } from '@/stores';
import { pluginErrorMessage } from '../domain/plugin-error';
import { usePluginRuntime } from '../components/plugin-runtime-provider';
import type { PluginInstallPreview } from '../services/plugin-installer';

/**
 * Inspects a package and holds it for confirmation. Packages that no added catalog vouches for
 * are only accepted in developer mode.
 */
export function usePluginInstall() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const runtime = usePluginRuntime();
  const developerMode = usePluginStore((state) => state.developerMode);
  const [preview, setPreview] = useState<PluginInstallPreview>();
  const [isInstalling, setIsInstalling] = useState(false);

  const fail = useCallback(
    (error: unknown) => toast.show({ variant: 'danger', label: pluginErrorMessage(error) }),
    [toast],
  );

  /** Resolves to whether the package is waiting for confirmation. */
  const inspect = useCallback(
    async (archive: Uint8Array | Promise<Uint8Array>): Promise<boolean> => {
      try {
        const next = await runtime.inspectPackage(await archive);
        if (next.trust.kind !== 'verified' && !developerMode) {
          toast.show({ variant: 'default', label: t('plugins.installNeedsDeveloperMode') });
          return false;
        }
        setPreview(next);
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    [developerMode, fail, runtime, t, toast],
  );

  const confirm = async () => {
    if (!preview) return;
    setIsInstalling(true);
    try {
      const result = await runtime.installPackage(preview, true);
      toast.show({
        variant: 'success',
        label: t(result === 'pending' ? 'plugins.installedAfterRestart' : 'plugins.installed'),
      });
      setPreview(undefined);
    } catch (error) {
      fail(error);
    } finally {
      setIsInstalling(false);
    }
  };

  return {
    inspect,
    dialogProps: {
      preview,
      isInstalling,
      onConfirm: () => void confirm(),
      onCancel: () => setPreview(undefined),
    },
  };
}
