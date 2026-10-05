import { describe, expect, it } from 'vitest';
import configure from '../../app.config';

describe('EPUB document association', () => {
  it('preserves existing filters and registers opening and sharing EPUB files', () => {
    const existing = { action: 'VIEW', data: [{ scheme: 'lunar' }], category: ['DEFAULT'] };
    const config = configure({
      config: { name: 'lunar', slug: 'lunar', android: { intentFilters: [existing] } },
    } as Parameters<typeof configure>[0]);
    expect(config.android?.intentFilters).toContainEqual(existing);
    for (const action of ['VIEW', 'SEND', 'SEND_MULTIPLE']) {
      expect(config.android?.intentFilters).toContainEqual(
        expect.objectContaining({
          action,
          data: expect.arrayContaining([expect.objectContaining({ mimeType: 'application/epub+zip' })]),
        }),
      );
    }
  });

  it('declares the EPUB UTI without replacing existing iOS document types', () => {
    const existing = { CFBundleTypeName: 'Existing document' };
    const config = configure({
      config: { name: 'lunar', slug: 'lunar', ios: { infoPlist: { CFBundleDocumentTypes: [existing] } } },
    } as Parameters<typeof configure>[0]);
    expect(config.ios?.infoPlist?.CFBundleDocumentTypes).toContainEqual(existing);
    expect(config.ios?.infoPlist?.CFBundleDocumentTypes).toContainEqual(
      expect.objectContaining({
        LSItemContentTypes: ['org.idpf.epub-container'],
      }),
    );
    expect(config.ios?.infoPlist?.UTImportedTypeDeclarations).toContainEqual(
      expect.objectContaining({
        UTTypeIdentifier: 'org.idpf.epub-container',
        UTTypeTagSpecification: { 'public.filename-extension': ['epub'], 'public.mime-type': 'application/epub+zip' },
      }),
    );
  });
});
