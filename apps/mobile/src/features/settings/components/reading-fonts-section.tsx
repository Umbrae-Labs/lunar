import { useToast } from 'heroui-native/toast';
import { useCallback, useState } from 'react';

import { ConfirmModal } from '@/components/ui/confirm-modal';
import { importReaderFont, type ReaderFontImportFailure, removeReaderFont } from '@/features/reader';
import { useTranslation } from '@/i18n';
import { type ImportedReaderFont, useFontStore } from '@/stores';
import { SettingRow } from './setting-row';
import { SettingSection } from './setting-section';

/**
 * Manages the imported font catalog: what the reader can offer, without the
 * reader being open. The reading settings page also offers role-based selection.
 */
export function ReadingFontsSection() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fonts = useFontStore((state) => state.fonts);
  const [isImporting, setIsImporting] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<ImportedReaderFont>();

  const handleImport = useCallback(async () => {
    setIsImporting(true);
    try {
      const result = await importReaderFont();
      if (!result) {
        return;
      }
      if (result.ok) {
        toast.show({
          variant: 'success',
          label: t('settings.fontImported', { family: result.font.family }),
        });
        return;
      }
      toast.show({
        variant: 'danger',
        label: t('settings.importFont'),
        description: importFailureMessage(result.reason, t),
      });
    } catch (error) {
      toast.show({
        variant: 'danger',
        label: t('settings.importFont'),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsImporting(false);
    }
  }, [t, toast]);

  const handleRemove = useCallback(() => {
    if (!pendingRemoval) {
      return;
    }
    // Removal also repoints any role that selected this font, so the catalog and
    // the typography can never disagree about what exists.
    removeReaderFont(pendingRemoval.id);
    toast.show({
      variant: 'success',
      label: t('settings.fontRemoved', { family: pendingRemoval.family }),
    });
    setPendingRemoval(undefined);
  }, [pendingRemoval, t, toast]);

  return (
    <>
      <SettingSection title={t('settings.fontManagement')}>
        <SettingRow
          variant="action"
          title={isImporting ? t('settings.importingFont') : t('settings.importFont')}
          description={t('settings.readingFontsDescription')}
          accessibilityHint={t('settings.importFontHint')}
          isDisabled={isImporting}
          onPress={() => void handleImport()}
        />
        {fonts.map((font) => (
          <SettingRow
            key={font.id}
            variant="destructive"
            title={font.family}
            description={`${font.fileName} · ${formatFontSize(font.byteLength)}`}
            accessibilityLabel={t('settings.removeFont', { family: font.family })}
            accessibilityHint={t('settings.removeFontHint')}
            onPress={() => setPendingRemoval(font)}
          />
        ))}
      </SettingSection>

      <ConfirmModal
        confirmLabel={t('action.delete')}
        description={t('settings.removeFontHint')}
        isDestructive
        isOpen={pendingRemoval !== undefined}
        onConfirm={handleRemove}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setPendingRemoval(undefined);
          }
        }}
        title={
          pendingRemoval ? t('settings.removeFont', { family: pendingRemoval.family }) : t('settings.readingFonts')
        }
      />
    </>
  );
}

function importFailureMessage(reason: ReaderFontImportFailure, t: ReturnType<typeof useTranslation>['t']): string {
  switch (reason) {
    case 'tooLarge':
      return t('settings.fonts.errors.tooLarge');
    case 'notAFont':
      return t('settings.fonts.errors.notAFont');
    case 'collection':
      return t('settings.fonts.errors.collection');
    case 'variable':
      return t('settings.fonts.errors.variable');
    default:
      return t('settings.fonts.errors.unreadable');
  }
}

function formatFontSize(byteLength: number): string {
  if (byteLength >= 1024 * 1024) {
    return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(byteLength / 1024))} KB`;
}
