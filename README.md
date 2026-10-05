<img src="apps/mobile/public/hero.webp" alt="Lunar" />

> The character appearing in the picture is Takashima Zakuro from the game "Wonderful Everyday Down the Rabbit Hole"

Lunar is a lightweight, cross-platform EPUB reader with native rendering.

Powered by [Rito](https://github.com/Ringyuki/Rito), Lunar combines a Skia rendering pipeline with a native C++ compositor to deliver consistent visuals across platforms, polished page-turn animations, and high-performance native rendering.

## Installation

### Download from Releases

Go to the [Releases](https://github.com/Umbrae-Labs/lunar/releases/latest) page and download the latest installer.

You can also download the latest prerelease from [Releases](https://github.com/Umbrae-Labs/lunar/releases) to try the latest features. Each nightly provides a standalone Nightly APK and a Develop APK that requires an Expo development server.

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

On Windows, use static checks, tests, Expo configuration inspection, and JavaScript bundling. Android native builds run in the Linux CNB environment.

## Contributing

Issues and Pull Requests are welcome.

## From Open Source to Open Source

Inspiration:

- [Readest](https://readest.com/) - Readest is a modern, feature-rich ebook reader designed for avid readers offering seamless cross-platform access, powerful tools, and an intuitive interface to elevate your reading experience.
- [Persimmon](https://persimmon.cc/) - A lightweight, native-rendered cross-platform EPUB reader.

## License

This project is licensed under [AGPL v3](LICENSE).
