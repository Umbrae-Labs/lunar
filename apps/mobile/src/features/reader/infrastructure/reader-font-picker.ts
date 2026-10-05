import * as DocumentPicker from 'expo-document-picker';

export interface PickedReaderFont {
  readonly uri: string;
  readonly fileName: string;
  readonly fileSize?: number;
}

/**
 * Font formats are inconsistently typed by the pickers on each platform, so the
 * list spans the specific font MIME types and the generic binary ones; the
 * import then validates the actual bytes rather than trusting the label.
 */
const FONT_MIME_TYPES = [
  'font/ttf',
  'font/otf',
  'font/sfnt',
  'application/x-font-ttf',
  'application/x-font-otf',
  'application/x-font-opentype',
  'application/octet-stream',
];

export async function pickReaderFont(): Promise<PickedReaderFont | undefined> {
  const result = await DocumentPicker.getDocumentAsync({
    type: FONT_MIME_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
    base64: false,
  });

  if (result.canceled) {
    return undefined;
  }
  const asset = result.assets[0];
  if (!asset) {
    return undefined;
  }
  return { uri: asset.uri, fileName: asset.name, fileSize: asset.size };
}
