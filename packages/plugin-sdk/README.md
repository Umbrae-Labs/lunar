# @umbrae-labs/lunar-plugin-sdk

Types and tooling contracts for Lunar reader plugins. Lunar supplies the runtime of this package when it runs a plugin; plugin bundles keep it external.

Plugins run with the same access as the app. Only install plugins from sources you trust.

## Quick start

Requires Node.js 22.18 or newer.

```sh
npx @umbrae-labs/lunar-plugin-cli init my-plugin --id org.example.my-plugin --name "My plugin"
cd my-plugin
npm install
npx lunar-plugin dev
```

In Lunar, open **Settings → Plugin settings**, turn on **Developer mode**, and enter one of the addresses that `lunar-plugin dev` prints. Saving a source file rebuilds the plugin and reloads it in the app, and the plugin's `ctx.log` output appears in the terminal. With the phone on USB, run `adb reverse tcp:5757 tcp:5757` and use the `127.0.0.1` address.

`npx lunar-plugin pack` writes `dist/<id>-<version>.lunar-plugin`. Unsigned packages can only be installed in developer mode.

Coding agents can learn the SDK and CLI from the `lunar-plugin` skill:

```sh
npx skills add Umbrae-Labs/lunar --skill lunar-plugin
```

## Publishing a catalog

Lunar ships with no plugin catalog. Users add the catalogs of publishers they trust, and packages signed with a catalog's key install without developer mode.

```sh
npx lunar-plugin keygen lunar-signing-key.pem          # Ed25519, PKCS#8 PEM; keep it secret
npx lunar-plugin pack --key lunar-signing-key.pem      # adds signature.json
npx lunar-plugin catalog dist/*.lunar-plugin --out site --key lunar-signing-key.pem --name "My plugins"
```

Serve the `site` directory from any HTTPS host. Users add the URL of `site/index.json` under **Settings → Plugin settings → Plugin catalogs**, or open `lunar://add-catalog?url=<index URL>`. Signatures are pure Ed25519 (RFC 8032) over `integrity.json`; the public key is published as a JWK (RFC 8037) and identified by its RFC 7638 thumbprint, which `keygen` prints and `publisherKeyId` in `manifest.json` may pin. Later versions of an installed plugin must be signed with the same key.

## A plugin

```tsx
import { definePlugin, useReader, useT } from '@umbrae-labs/lunar-plugin-sdk';
import { PanelHeader, Stack, Text } from '@umbrae-labs/lunar-plugin-sdk/ui';

export default definePlugin({
  activate(ctx) {
    ctx.commands.register('open-panel', () => ctx.ui.openPanel('main'));
    ctx.ui.registerSlot('reader.panel', 'main', MainPanel);
    ctx.reader.on('chapterChange', ({ chapter }) => ctx.log.info('chapter', chapter?.title));
  },
});

function MainPanel() {
  const t = useT();
  const chapter = useReader((session) => session?.location?.chapter?.title);
  return (
    <Stack gap="md">
      <PanelHeader title={t('panel.title')} />
      <Text>{chapter ?? '—'}</Text>
    </Stack>
  );
}
```

Every command, panel, overlay, route and setting the code registers must also be declared in `manifest.json`. `lunar-plugin validate` checks the manifest, locales, imports and package limits.

## Stored data and updates

`ctx.storage` is a private JSON store. Writes run in call order, and `update(key, fn)` reads and writes in one step, so counters never lose a concurrent increment.

`NetworkResponse.bytes` exposes the original response bytes for images and other binary resources; `body` contains the UTF-8 decoded text. Set `responseType: 'bytes'` on binary requests to skip the text allocation. Plugins with the `library.import` permission can call `ctx.library.importEpub({ fileName, bytes, onProgress })` to import a user-requested EPUB through Lunar's normal library pipeline. Imports are limited to 100 MiB.

When a new version stores data differently, raise `dataVersion` in `manifest.json` and convert the data in `migrate`:

```ts
export default definePlugin({
  async migrate({ from, to, storage }) {
    if (from === 1 && to === 2) {
      for (const key of await storage.keys('book:')) {
        await storage.update(key, (value) => toVersion2(value));
      }
    }
  },
  activate(ctx) {
    // Runs only after the data has the manifest's dataVersion.
  },
});
```

Lunar backs up the plugin's data before `migrate` runs. If `migrate` or the first `activate` of an update fails, the data and the previously installed version are restored.

Text from `ctx.reader.session.getVisibleText()` carries a `key` that stays the same for the same sentence across page turns, reflows and sessions; use it rather than `range` or a location to recognise text you have already seen.

## What a plugin can use

| Module                 | Contents                                                                 |
| ---------------------- | ------------------------------------------------------------------------ |
| `@umbrae-labs/lunar-plugin-sdk`    | `definePlugin`, the plugin context types and the `use*` hooks            |
| `@umbrae-labs/lunar-plugin-sdk/ui` | Themed components: layout, text, buttons, fields, lists and empty states |
| `react`                | The app's React, including hooks                                         |
| `react-native`         | The app's React Native components                                        |

Native modules, `className`, worklets, dynamic `import()` and Node.js built-ins are rejected at build time. Probe optional features through `ctx.host.capabilities`.

The full contract and its rationale are in [docs/design/plugin-sdk.md](../../docs/design/plugin-sdk.md). The official [reading stats plugin](../../plugins/reading-stats) is a complete example.
