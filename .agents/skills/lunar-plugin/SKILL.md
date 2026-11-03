---
name: lunar-plugin
description: >
  编写、构建、调试、打包与发布 Lunar 阅读器插件。涉及 @umbrae-labs/lunar-plugin-sdk（definePlugin、PluginContext、
  use* Hooks、@umbrae-labs/lunar-plugin-sdk/ui 组件）、manifest.json、locales、lunar-plugin CLI（init、build、validate、
  dev、pack、keygen、catalog）、.lunar-plugin 包、插件签名与插件目录时使用。也用于修改仓库 plugins/ 下的
  官方插件（reading-stats、wenku8、lnovel）。不覆盖宿主侧加载器实现（apps/mobile/src/features/plugins）。
---

# Lunar 插件开发

Lunar 插件是一个单文件 CommonJS 入口（`main.js`）加一份 `manifest.json`，打包为 `.lunar-plugin`（ZIP）。插件与应用运行在同一个 JavaScript 环境中，共享宿主的 React 与 React Native。

## 权威来源

本技能是导航与约束摘要。字段、签名或限制存在疑问时，以下文件为准：

| 内容                         | 仓库内                                                                | 外部项目（npm 安装后）                           |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| 上下文 API、事件、错误码类型 | `packages/plugin-sdk/src/types.ts`                                    | `node_modules/@umbrae-labs/lunar-plugin-sdk/dist/types.d.ts` |
| Hooks                        | `packages/plugin-sdk/src/index.ts`                                    | `.../dist/index.d.ts`                            |
| 界面组件与属性               | `packages/plugin-sdk/src/ui.ts`                                       | `.../dist/ui.d.ts`                               |
| 清单 Schema、权限、图标名    | `packages/plugin-sdk/src/manifest.ts`                                 | `.../dist/manifest.d.ts`                         |
| 构建限制                     | `packages/plugin-cli/src/build.ts`                                    | —                                                |
| 设计取舍与预算               | `docs/design/plugin-sdk.md`                                           | —                                                |
| 完整示例                     | `plugins/reading-stats`（阅读）、`plugins/wenku8`（整页、网络、导入） | —                                                |

详细参考：

- [references/manifest.md](references/manifest.md)：清单字段、插槽、设置、权限与本地化规则
- [references/api.md](references/api.md)：`ctx` 各接口、Hooks、UI 组件、权限对照与运行时限制

## 工作流

### 仓库内（`plugins/<name>`）

插件是 pnpm workspace 成员，依赖 `workspace:*`，CLI 直接从 TypeScript 源码运行（Node ≥ 22.18）。

```sh
# 新建：init 要求目标目录为空或不存在
node packages/plugin-cli/bin/lunar-plugin.mjs init plugins/<name> --id moe.lunar.<name> --name "<显示名>"
```

`init` 生成的是面向外部的 `package.json`，进入仓库后需对齐现有插件（参考 `plugins/reading-stats/package.json`）：

- `name` 改为 `@lunar/plugin-<name>`，保留 `private: true`、`type: "module"`
- `@umbrae-labs/lunar-plugin-cli` 与 `@umbrae-labs/lunar-plugin-sdk` 改为 `workspace:*`，增加 `vitest`
- `scripts.check` 设为 `pnpm run typecheck && pnpm run test && lunar-plugin validate`
- 补充 `defaultLocale`、`author`、`license`；随后在仓库根目录执行 `pnpm install`

日常命令在插件目录或经 filter 执行：

```sh
pnpm --filter @lunar/plugin-<name> check        # 类型检查 + 单元测试 + validate
pnpm --filter @lunar/plugin-<name> dev          # 热重载到开发构建
pnpm --filter @lunar/plugin-<name> pack         # 产出 dist/<id>-<version>.lunar-plugin
```

### 外部项目

`@umbrae-labs/lunar-plugin-sdk` 与 `@umbrae-labs/lunar-plugin-cli` 发布到 npm 之后可用。全局未安装时，`npx` 需写完整包名：

```sh
npx @umbrae-labs/lunar-plugin-cli init my-plugin --id org.example.my-plugin --name "My plugin"
cd my-plugin && npm install
npx lunar-plugin dev     # 安装后 bin 名为 lunar-plugin
```

## CLI 命令

`directory` 默认为当前目录。查看帮助用 `lunar-plugin help`。

| 命令                                                                           | 作用                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `init <dir> --id <id> --name <name>`                                           | 生成 manifest、locales（zh-CN、en）、`src/index.tsx`、tsconfig、package.json          |
| `build [dir]`                                                                  | esbuild 打包为 `dist/main.js`，执行下文的构建限制                                     |
| `validate [dir]`                                                               | 校验清单、本地化、构建结果与包体限制；提交前必跑                                      |
| `pack [dir] [--key <pem>]`                                                     | 构建并写出 `dist/<id>-<version>.lunar-plugin`；带 `--key` 时附加 `signature.json`     |
| `dev [dir] [--port 5757] [--host 0.0.0.0]`                                     | 监听源码重建，向开发构建提供最新版本，并把插件 `ctx.log` 输出打印到终端               |
| `keygen [file]`                                                                | 生成 Ed25519 私钥（PKCS#8 PEM，默认 `lunar-signing-key.pem`），打印 key id 与公钥 JWK |
| `catalog <pkg...> --out <dir> --key <pem> --name <name> [--badge] [--website]` | 生成目录 `index.json` 并复制包与图标                                                  |

入口按 `package.json` 的 `lunar.entry`，否则依次查找 `src/index.tsx|ts|jsx|js`。随包复制的静态文件为 `assets/**`、`LICENSE`、`LICENSE.md`、`README.md` 与 `locales/*.json`。

### 开发连接

1. 运行 `lunar-plugin dev`，终端打印带一次性 `token` 的地址。
2. 在 Lunar 中打开 **设置 → 插件设置**，开启 **开发者模式**，在 **开发服务地址** 填入地址并点击 **连接**。
3. USB 连接时执行 `adb reverse tcp:5757 tcp:5757`，使用 `http://127.0.0.1:5757/?token=...`。

保存源码后宿主撤销旧代次的全部注册并执行新入口。esbuild 只监听入口依赖图中的文件；单独修改 `manifest.json` 或 locales 后，保存任一源码文件触发重建。

### 签名与目录

```sh
lunar-plugin keygen lunar-signing-key.pem                 # 私钥保密，*.pem 已在 .gitignore 中
lunar-plugin pack --key lunar-signing-key.pem
lunar-plugin catalog dist/*.lunar-plugin --out site --key lunar-signing-key.pem --name "My plugins"
```

`site/` 部署到任意 HTTPS 地址，用户在 **插件设置 → 插件目录** 添加 `index.json` 地址，或打开 `lunar://add-catalog?url=<index URL>`。未签名包只能在开发者模式安装。清单声明 `publisherKeyId` 时 `pack` 必须带匹配的 `--key`；同一插件的后续版本必须用同一把密钥签名，同一版本号的包内容不可变，修改后需提升 `version`。

## 核心规则

### 清单与代码必须一致

代码中注册的每一项都要在 `manifest.json` 声明，标识逐一对应：

| 代码                                             | 清单位置                                    |
| ------------------------------------------------ | ------------------------------------------- |
| `ctx.commands.register('<id>', fn)`              | `contributes.commands[].id`                 |
| `ctx.ui.registerSlot('reader.panel', '<id>', C)` | `contributes.slots["reader.panel"][].id`    |
| `ctx.ui.registerSlot('reader.overlay', ...)`     | `contributes.slots["reader.overlay"][].id`  |
| `ctx.ui.registerSlot('settings.plugin', ...)`    | `contributes.slots["settings.plugin"][].id` |
| `ctx.ui.registerRoute('<pageId>', C)`            | `contributes.slots["app.route"][].id`       |
| `ctx.settings.get('<key>')`、`useSetting`        | `contributes.settings[].key`                |
| 调用需要权限的接口                               | `permissions[].name`（附 `reason`）         |

工具栏按钮与底部标签只在清单中声明（`reader.toolbar` 绑定命令，`app.tab` 指向路由），无需代码注册。

### 构建限制

`lunar-plugin build` 会拒绝以下写法，宿主运行时也执行同样的模块检查：

- 宿主提供、保持外部的模块只有：`react`、`react/jsx-runtime`、`react-native`、`@umbrae-labs/lunar-plugin-sdk`、`@umbrae-labs/lunar-plugin-sdk/ui`
- 禁止引用：`@umbrae-labs/lunar-plugin-sdk/manifest` 与 `/package-format`（仅供工具链）、`expo*`、`react-native-*`、`@react-native/*`、`heroui-native`、`uniwind`、`@gorhom/*`、`@shopify/react-native-skia`、`@umbrae-labs/*`、`react-dom`
- 禁止 Node.js 内置模块、动态 `import()`、`'worklet'` 指令
- 插件自身源码中禁止出现 `className`，样式用组件属性或 `style` + `useTheme()`
- 纯 JavaScript 依赖（如 `fflate`）会被打进 `main.js`；`main.js` 上限 2 MiB

### 编写要点

- 入口默认导出 `definePlugin({ activate, deactivate?, migrate? })`。`activate` 只做注册与轻量初始化，总耗时上限 1 秒；耗时任务由命令、事件或组件触发。
- 所有注册在停用、重载或激活失败时由宿主自动撤销；插件自己创建的定时器、订阅等放进 `ctx.subscriptions`（`{ dispose() }`）。
- 开发模式每次重载产生新代次（`ctx.plugin.generation`），旧代次的回调结果被丢弃，不要把状态挂在模块顶层变量上跨代次复用。
- 能声明 `activationEvents` 的只有 `onStartup` 与 `onReaderOpen`；使用插件入口时宿主会隐式激活，只有需要观察完整阅读会话时才声明 `onReaderOpen`。
- 文本一律走 `locales/`：组件中用 `useT()`，`activate` 中用 `ctx.i18n.t()`，插值语法为 `{{name}}`。
- 可选能力先查 `ctx.host.capabilities['<name>']`，缺失表示不可用（例如 `reader.chapterText` 当前未实现）。
- 网络优先用 `ctx.network.request`；二进制资源设 `responseType: 'bytes'` 并读 `response.bytes`。长任务传 `AbortSignal`。
- 存储格式变化时提升清单 `dataVersion` 并实现 `migrate`；宿主在迁移前备份，失败时回滚数据与版本。
- `useReader(selector)` 的选择器返回原始值或已有对象，避免每次返回新对象导致重复渲染。
- 记住识别过的正文用 `TextSegment.key`（跨翻页、重排、会话稳定），不要用 `range` 或定位符。

### 测试

SDK 的运行时函数（`usePlugin`、`useReader` 等）在宿主之外调用会直接抛错，单元测试无法渲染插件组件。做法是把逻辑拆到不依赖宿主的模块（`stats.ts`、`client.ts`、`epub.ts`），对 `NetworkAPI`、`StorageAPI` 等以接口注入，用 vitest 测这些模块；SDK 只做 `import type`。参见 `plugins/wenku8/tests/client.test.ts` 与 `plugins/reading-stats/tests/stats.test.ts`。

真机行为（面板、装饰、导航、导入）需在开发构建中通过 `lunar-plugin dev` 验证。

## 完成前检查

- [ ] `lunar-plugin validate` 通过（仓库内为 `pnpm --filter <pkg> check`）
- [ ] 每个注册项、设置键、权限都在清单中声明，反之清单中声明的组件插槽在代码中有注册
- [ ] 每个 `%key%` 在所有 `locales/*.json` 中都有对应文本
- [ ] 修改了已发布插件时，`manifest.json` 与 `package.json` 的 `version` 同步提升；存储格式变化时提升 `dataVersion` 并实现 `migrate`
