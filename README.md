<img src="apps/mobile/public/hero.webp" alt="Lunar" />

> The character appearing in the picture is Takashima Zakuro from the game "Wonderful Everyday Down the Rabbit Hole"

Lunar is a lightweight, cross-platform, extensible EPUB reader with native rendering.

- **Unified native architecture**: powered by [Rito](https://github.com/Ringyuki/Rito), Lunar combines a Skia rendering pipeline with a native C++ compositor to deliver consistent visuals across platforms, polished page-turn animations, and high-performance native rendering.
- **Everything you want can be a plugin**: AI explanations of selected text, online book sources, or a feature nobody has thought of yet. You can build a plugin with your favorite coding assistant through a typed SDK: install the skill, describe the feature, then run lunar-plugin dev, which reloads it in the app on every save. Your reader becomes the one you want.

## Installation

### Download from Releases

Go to the [Releases](https://github.com/Umbrae-Labs/lunar/releases/latest) page and download the latest installer.

You can also download the latest prerelease from [Releases](https://github.com/Umbrae-Labs/lunar/releases) to try the latest features. Each nightly provides a standalone Nightly APK and a Develop APK that requires an Expo development server.

## Plugins

Plugins run inside Lunar and extend it through a typed SDK.
Plugins are distributed as signed `.lunar-plugin` packages through catalogs.

### Writing a plugin

```sh
npx @umbrae-labs/lunar-plugin-cli init my-plugin --id org.example.my-plugin --name "My plugin"
cd my-plugin && npm install
npx lunar-plugin dev    # rebuild on save and reload in Lunar
npx lunar-plugin pack   # write dist/<id>-<version>.lunar-plugin
```

To connect a running `dev` server, turn on **Developer mode** in **Settings → Plugin settings** and enter the address it prints. See the [SDK README](packages/plugin-sdk/README.md) and the [plugin SDK design](docs/design/plugin-sdk.md) for the API, permissions and limits.

## Development

This repository uses pnpm workspaces. The Expo application lives in `apps/mobile`. Shared SDK packages belong in `packages/*`, and independently packaged reading plugins belong in `plugins/*` as they are developed. Expo config plugins remain in `apps/mobile/plugins`.

Install dependencies and run commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm start
pnpm check
pnpm check:expo
```

Use `pnpm --filter @lunar/mobile <command>` for application-specific commands. EAS commands run from `apps/mobile`; repository release scripts remain in `scripts`. See [release instructions](docs/releasing.md) and the [plugin SDK design](docs/design/plugin-sdk.md).

## Contributing

Issues and Pull Requests are welcome.

## From Open Source to Open Source

Inspiration:

- [Readest](https://readest.com/) - Readest is a modern, feature-rich ebook reader designed for avid readers offering seamless cross-platform access, powerful tools, and an intuitive interface to elevate your reading experience.
- [Persimmon](https://persimmon.cc/) - A lightweight, native-rendered cross-platform EPUB reader.

## License

This project is licensed under [AGPL v3](LICENSE).
