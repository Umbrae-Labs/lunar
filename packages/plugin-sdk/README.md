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

## Publishing a GitHub release

`lunar-plugin init` includes GitHub Actions for publishing releases and submitting market entries. Commit the npm lockfile created by `npm install`. Run `npx lunar-plugin keygen` once, back up the private PEM and save it as the repository secret `LUNAR_PLUGIN_SIGNING_KEY`. Tag the manifest version with a leading `v`. The release action uploads the signed `.lunar-plugin` and `market-entry.json`.

Readers can paste the public GitHub repository URL, a release tag URL, or a release asset URL into **Plugins → Get plugins**. A release with several plugin assets requires an individual asset URL. Signed downloads identify the repository and publisher key before the reader confirms installation. Updates must use the same author key.

Set the repository variable `LUNAR_MARKET_REPOSITORY` to the market's `owner/repo`. Run **Submit plugin to Lunar** to generate a GitHub submission link for that release. To open the PR automatically, set the secret `LUNAR_SUBMISSION_TOKEN` to a GitHub token authorized to fork the market, push a branch on the author's fork and open a pull request. Run **Submit plugin to Lunar** with the release tag. Alternatively, submit the release's `market-entry.json` as `plugins/<plugin-id>.json` in a pull request.

To create the market repository, run `lunar-plugin init-market lunar-plugin-market`, run `npm install` there and commit the lockfile. Enable GitHub Pages with GitHub Actions as the source. Set the repository secret `LUNAR_MARKET_SIGNING_KEY` to the dedicated market PEM. Merging reviewed entries into `main` publishes the signed `index.json` and its `config.json` to Pages.

Market maintainers review the release version and its digest before merging. Generate the static index from merged entries using a dedicated market signing key:

```sh
npx lunar-plugin market-index plugins/*.json --key market.pem --out site/index.json --config-out site/config.json
```

Set the app build variable `EXPO_PUBLIC_PLUGIN_MARKET_CONFIG_URL` to the permanent HTTPS address of `config.json`. For GitHub-triggered Android builds, set the GitHub repository variable with the same name. The config endpoint is the trust authority for the index address and its public Ed25519 key. Protect its domain and publishing credentials accordingly.

On the **market repository**, set the optional variable `LUNAR_GITHUB_RELEASE_MIRROR` to an HTTPS proxy prefix. Run **Publish Lunar market** after changing or removing it. The next plugin download reads the new configuration. The default index is a sibling `index.json`. To serve the signed index elsewhere, publish it there and set `LUNAR_MARKET_INDEX_URL` to its absolute HTTPS address. Rotating the market signing secret and republishing updates the index and its public key together. An installed plugin still requires its original author signature for updates.

Market refreshes load the configuration before verifying the index. Downloads use GitHub if the config endpoint or mirror is unavailable. Builds without a configured endpoint still support installation by GitHub URL.


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

| Module                             | Contents                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `@umbrae-labs/lunar-plugin-sdk`    | `definePlugin`, the plugin context types and the `use*` hooks            |
| `@umbrae-labs/lunar-plugin-sdk/ui` | Themed components: layout, text, buttons, fields, lists and empty states |
| `react`                            | The app's React, including hooks                                         |
| `react-native`                     | The app's React Native components                                        |

Native modules, `className`, worklets, dynamic `import()` and Node.js built-ins are rejected at build time. Probe optional features through `ctx.host.capabilities`.

The full contract and its rationale are in [docs/design/plugin-sdk.md](../../docs/design/plugin-sdk.md). The official [reading stats plugin](../../plugins/reading-stats) is a complete example.
