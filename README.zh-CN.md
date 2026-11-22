<img src="apps/mobile/public/hero.webp" alt="Lunar" />

[English](README.md) | **简体中文**

> 图中角色为游戏《美好的每一天 ～不连续的存在～》中的高岛柘榴

Lunar 是一款轻量、跨平台、可扩展的原生渲染 EPUB 阅读器。

- **统一原生架构**：基于 [Rito](https://github.com/Ringyuki/Rito) 驱动，Lunar 结合 Skia 渲染管线与原生 C++ 合成器，带来跨平台一致的视觉效果、细腻流畅的翻页动画以及高性能的原生渲染体验。
- **万物皆可插件**：划词 AI 释义、在线书源，或是尚未有人想到过的功能。借助带完整类型定义的 SDK，你可以配合自己喜欢的编程助手构建插件：安装 skill、描述想要的功能，再运行 `lunar-plugin dev`，每次保存都会在应用中热重载。让阅读器成为你想要的样子。

## 安装

### 从 Releases 下载

前往 [Releases](https://github.com/Umbrae-Labs/lunar/releases/latest) 页面下载最新安装包。

你也可以从 [Releases](https://github.com/Umbrae-Labs/lunar/releases) 下载最新的预发布版本（Prerelease）来体验新特性。每个 Nightly 构建均提供可独立安装的 Nightly APK，以及需要连接 Expo 开发服务器的 Develop APK。

## 插件

插件运行在 Lunar 内部，通过带类型定义的 SDK 扩展应用能力。
插件以经过签名的 `.lunar-plugin` 包形式，通过插件目录（catalog）分发。

### 编写插件

```sh
npx @umbrae-labs/lunar-plugin-cli init my-plugin --id org.example.my-plugin --name "My plugin"
cd my-plugin && npm install
npx lunar-plugin dev    # 保存时自动重新构建并在 Lunar 中重载
npx lunar-plugin pack   # 生成 dist/<id>-<version>.lunar-plugin
```

如需连接正在运行的 `dev` 服务器，请前往 **设置 → 插件设置** 开启 **开发者模式**，并填入终端输出的地址。API、权限与限制详见 [SDK README](packages/plugin-sdk/README.md) 与 [插件 SDK 设计文档](docs/design/plugin-sdk.md)。

## 开发

本仓库使用 pnpm workspaces。Expo 应用位于 `apps/mobile`；共享 SDK 包位于 `packages/*`；独立打包的阅读插件随开发进度置于 `plugins/*`；Expo 配置插件（config plugins）保留在 `apps/mobile/plugins`。

在仓库根目录安装依赖并运行命令：

```sh
pnpm install --frozen-lockfile
pnpm start
pnpm check
pnpm check:expo
```

运行特定于移动应用的命令时，请使用 `pnpm --filter @lunar/mobile <command>`。EAS 命令需在 `apps/mobile` 目录下执行；仓库发布脚本保留在 `scripts` 目录。详见 [发布说明](docs/releasing.md) 与 [插件 SDK 设计文档](docs/design/plugin-sdk.md)。

## 参与贡献

欢迎提交 Issue 和 Pull Request。

## 源于开源，回馈开源

灵感来源：

- [Readest](https://readest.com/) - 面向深度阅读者的现代化、功能丰富的电子书阅读器，提供无缝的跨平台访问、强大的工具与直观的界面，提升阅读体验。
- [Persimmon](https://persimmon.cc/) - 轻量、原生渲染的跨平台 EPUB 阅读器。
- [mihon](https://github.com/mihonapp/mihon) - 适用于 Android 的免费开源漫画阅读器。
- [cordis](https://github.com/cordiverse/cordis) - 时空可组合元框架（Meta-Framework of Spatiotemporal Composability）。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) - DeepSeek Harness：万物皆插件（Everything is a Plugin）。

## 开源协议

本项目基于 [AGPL v3](LICENSE) 协议开源。
