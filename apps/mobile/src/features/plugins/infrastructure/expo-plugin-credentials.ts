import * as SecureStore from 'expo-secure-store';

// Plugin and credential ids never contain "_", so the key names cannot collide.
const keyFor = (pluginId: string, credentialId: string) => `lunar-plugin-credential_${pluginId}_${credentialId}`;

/** Keys are encrypted with an Android Keystore or iOS Keychain key and never leave this device. */
const Options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function readPluginSecret(pluginId: string, credentialId: string): Promise<string | undefined> {
  return (await SecureStore.getItemAsync(keyFor(pluginId, credentialId), Options)) ?? undefined;
}

export async function writePluginSecret(pluginId: string, credentialId: string, secret: string): Promise<void> {
  await SecureStore.setItemAsync(keyFor(pluginId, credentialId), secret, Options);
}

export async function deletePluginSecret(pluginId: string, credentialId: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(pluginId, credentialId), Options);
}
