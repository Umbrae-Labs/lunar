import * as DocumentPicker from 'expo-document-picker';

export interface PickedEpub {
  readonly uri: string;
  readonly fileName: string;
  readonly fileSize?: number;
}

export async function pickEpubs(): Promise<readonly PickedEpub[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/epub+zip', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: true,
    base64: false,
  });

  if (result.canceled) {
    return [];
  }

  return result.assets.map((asset) => ({
    uri: asset.uri,
    fileName: asset.name,
    fileSize: asset.size,
  }));
}
