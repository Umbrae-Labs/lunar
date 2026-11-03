import { useRouter, type Href } from 'expo-router';
import { useToast } from 'heroui-native/toast';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { ConfirmOptions } from '@umbrae-labs/lunar-plugin-sdk';

import { ConfirmModal } from '@/components/ui/confirm-modal';
import { useTranslation } from '@/i18n';
import { ReaderExtensionProvider } from '@/features/reader';
import { getPluginRuntime, type PluginRuntime } from '../runtime/plugin-runtime';
import { PluginCredentialSheet, type PluginCredentialTarget } from './plugin-credential-sheet';
import { createPluginReaderExtensions } from './plugin-reader-extensions';

const PluginRuntimeContext = createContext<PluginRuntime | undefined>(undefined);

export function usePluginRuntime(): PluginRuntime {
  const runtime = useContext(PluginRuntimeContext);
  if (!runtime) throw new Error('usePluginRuntime must be used inside PluginRuntimeProvider');
  return runtime;
}

interface ConfirmRequest {
  readonly options: ConfirmOptions;
  readonly resolve: (confirmed: boolean) => void;
}

interface CredentialRequest {
  readonly target: PluginCredentialTarget;
  readonly resolve: () => void;
}

/** Starts the plugin host and connects it to the app's toasts, dialogs, navigation and reader. */
export function PluginRuntimeProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const runtime = useMemo(() => getPluginRuntime(), []);
  const extensions = useMemo(() => createPluginReaderExtensions(runtime.host), [runtime]);
  const { toast } = useToast();
  const router = useRouter();
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest>();
  const [credentialRequest, setCredentialRequest] = useState<CredentialRequest>();

  useEffect(
    () =>
      runtime.connectUi({
        toast: (label, tone) => toast.show({ variant: tone, label }),
        confirm: (options) =>
          new Promise<boolean>((resolve) => {
            setConfirmRequest((current) => {
              // Only one dialog is shown; a newer request declines the older one.
              current?.resolve(false);
              return { options, resolve };
            });
          }),
        openRoute: (pluginId, pageId, params) =>
          router.push({
            pathname: '/plugin/[pluginId]/[pageId]',
            params: { ...params, pluginId, pageId },
          } as unknown as Href),
        configureCredential: (pluginId, credentialId) =>
          new Promise<void>((resolve) => {
            setCredentialRequest((current) => {
              current?.resolve();
              return { target: { pluginId, credentialId }, resolve };
            });
          }),
      }),
    [router, runtime, toast],
  );

  useEffect(() => {
    let active = true;
    void runtime.start().then(() => {
      if (active) void runtime.host.trigger('onStartup');
    });
    return () => {
      active = false;
    };
  }, [runtime]);

  const settle = (confirmed: boolean) => {
    confirmRequest?.resolve(confirmed);
    setConfirmRequest(undefined);
  };

  return (
    <PluginRuntimeContext.Provider value={runtime}>
      <ReaderExtensionProvider host={extensions}>
        {children}
        <ConfirmModal
          isOpen={Boolean(confirmRequest)}
          title={confirmRequest?.options.title ?? ''}
          description={confirmRequest?.options.message}
          confirmLabel={confirmRequest?.options.confirmLabel ?? t('action.confirm')}
          cancelLabel={confirmRequest?.options.cancelLabel}
          isDestructive={confirmRequest?.options.destructive}
          onConfirm={() => settle(true)}
          onOpenChange={(open) => {
            if (!open) settle(false);
          }}
        />
        <PluginCredentialSheet
          runtime={runtime}
          target={credentialRequest?.target}
          onClose={() => {
            credentialRequest?.resolve();
            setCredentialRequest(undefined);
          }}
        />
      </ReaderExtensionProvider>
    </PluginRuntimeContext.Provider>
  );
}
