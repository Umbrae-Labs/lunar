# manifest.json 参考

Schema 定义于 `packages/plugin-sdk/src/manifest.ts`（`pluginManifestSchema`），所有对象均为严格对象，出现未知字段即校验失败。

## 顶层字段

| 字段                 | 要求                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| `manifestVersion`    | 固定为 `1`                                                                             |
| `id`                 | 小写反向域名，如 `org.example.my-plugin`，≤ 128 字符；发布后不可更改                   |
| `name`               | 1–120 字符，通常写 `"%name%"`                                                          |
| `version`            | 语义化版本 `X.Y.Z[-pre]`                                                               |
| `sdk`                | SDK 版本范围：精确版本、`^`、`~`、`>=`，或空格分隔的 `>=x <y`，如 `^0.1.3`             |
| `trust`              | 只能为 `"full"`（`sandboxed` 尚未实现，CLI 会拒绝）                                    |
| `main`               | 固定为 `"main.js"`                                                                     |
| `description`        | 可选，≤ 500 字符                                                                       |
| `author` / `license` | 可选                                                                                   |
| `homepage`           | 可选，必须为 HTTPS URL                                                                 |
| `icon`               | 宿主图标名、`{ "android": "...", "ios": "..." }`，或 `assets/**.png`（PNG，≤ 512 KiB） |
| `platforms`          | 可选，`["android", "ios"]` 的非空子集                                                  |
| `publisherKeyId`     | 可选，固定签名密钥的 RFC 7638 指纹（`keygen` 打印）                                    |
| `defaultLocale`      | 可选，如 `"zh-CN"`                                                                     |
| `dataVersion`        | 存储数据格式版本，默认 `1`；提升后宿主在 `activate` 前调用 `migrate`                   |
| `activationEvents`   | `onStartup`、`onReaderOpen` 的子集，默认 `[]`                                          |
| `permissions`        | `[{ "name": "...", "reason": "..." }]`，≤ 32 项，不可重复；`reason` 1–200 字符         |
| `contributes`        | 见下文                                                                                 |

`sdk` 至少写 `^0.1.3`。0.1.2 及更早的宿主只能解析旧模块名 `@lunar/plugin-sdk`，CLI 会拒绝仍然匹配 0.1.0–0.1.2 的范围。0.x 期间每个次版本都可能包含破坏变更。

## 图标名

`book` `bookmark` `chart` `edit` `extension` `headphones` `info` `list` `pause` `play` `search` `settings` `sparkles` `star` `stop` `text` `timer` `translate`

命令与插槽图标只能用图标名或平台符号对象；PNG 只能用于插件自身的 `icon`。

## 权限

| 权限                    | 解锁的接口                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `reader.events`         | `ctx.reader.on`、`session.current/subscribe/getToc`、`useReader`、`useReaderEvent` |
| `reader.content.read`   | `session.getVisibleText`、`getChapterText`、`search`                               |
| `reader.selection.read` | `session.readSelection`、`ctx.reader.intercept('selectionMenu', ...)`              |
| `reader.navigate`       | `session.goTo`、`next`、`previous`                                                 |
| `reader.decorations`    | `ctx.reader.decorations.create`                                                    |
| `library.import`        | `ctx.library.importEpub`                                                           |
| `network`               | `ctx.network.request` / `stream`、`Image` 加载远程图片（仅公网 HTTPS）、凭据       |

缺少权限时调用抛出 `PERMISSION_DENIED`。`reason` 写明用途与访问的服务，会在安装界面展示。旧写法 `network:https://host` 已被 CLI 拒绝，改用单一的 `network`。

## contributes

本地标识（命令、插槽条目、路由）规则：小写字母开头，由小写字母、数字、`-`、`.` 组成，≤ 64 字符；同类内不可重复。

### commands（≤ 64）

```json
{ "id": "open-panel", "title": "%command.open%", "icon": "sparkles" }
```

### slots

| 插槽              | 上限 | 条目字段                                               | 代码侧                                          |
| ----------------- | ---- | ------------------------------------------------------ | ----------------------------------------------- |
| `reader.toolbar`  | 4    | `id`、`command`（必须是已声明命令）、`title?`、`icon?` | 无需注册，点击执行命令                          |
| `reader.panel`    | 4    | `id`、`title`、`icon`（必填）                          | `ctx.ui.registerSlot('reader.panel', id, C)`    |
| `reader.overlay`  | 4    | `id`、`title?`                                         | `ctx.ui.registerSlot('reader.overlay', id, C)`  |
| `app.route`       | 16   | `id`、`title`、`icon?`、`hidden?`（默认 `false`）      | `ctx.ui.registerRoute(id, C)`                   |
| `app.tab`         | 1    | `id`、`route`（必须是未隐藏的路由）、`title?`、`icon?` | 无需注册                                        |
| `settings.plugin` | 1    | `id`、`title?`                                         | `ctx.ui.registerSlot('settings.plugin', id, C)` |

- 未声明 `hidden` 的路由是插件入口页面；多个入口页面时宿主显示页面标签，`icon` 用于标签。
- 需要参数的详情页（如 `openRoute('book', { id })`）声明 `"hidden": true`，并在参数缺失时给出可恢复的界面。
- `app.tab` 只声明入口，是否出现在底部导航由用户决定。
- `reader.overlay` 默认不拦截正文触摸，组件只在自身可交互区域接收事件。
- 未声明 `settings.plugin` 时，宿主根据 `contributes.settings` 自动生成设置表单。

### settings（≤ 64）

键名匹配 `^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$`，不可重复。公共字段：`key`、`type`、`title`、`description?`（≤ 300）、`default`。

| `type`    | 额外字段                                 | 约束                         |
| --------- | ---------------------------------------- | ---------------------------- |
| `boolean` | —                                        |                              |
| `number`  | `min?`、`max?`、`step?`（正数）          | `min ≤ default ≤ max`        |
| `string`  | `maxLength?`（≤ 2000）                   | `default` ≤ 2000 字符        |
| `select`  | `options: [{ value, label }]`（1–32 项） | `default` 必须是某个 `value` |

宿主负责类型与范围校验；读取到不满足当前声明的旧值时按默认值返回。

API Key 等密钥不要放进 `string` 设置（明文存储、设置页可见），改用 `credentials`。

### credentials（≤ 8，SDK ≥ 0.1.5）

```json
{
  "id": "api",
  "title": "%credential.title%",
  "description": "%credential.description%",
  "header": "Authorization",
  "prefix": "Bearer ",
  "baseUrl": "https://api.openai.com/v1"
}
```

| 字段      | 说明                                                                        |
| --------- | --------------------------------------------------------------------------- |
| `id`      | 本地标识；请求中以 `credential: id` 引用                                    |
| `header`  | 注入的请求头，默认 `Authorization`；不可为 `Cookie`、`Host`、`Sec-*` 等     |
| `prefix`  | 密钥前的文本（≤ 32），如 `Bearer `；默认空                                  |
| `baseUrl` | 建议的服务地址（HTTPS），用户可在凭据界面修改；密钥只发往该地址及其下级路径 |

声明凭据必须同时声明 `network` 权限。用户在插件详情页的「密钥」分组或 `ctx.credentials.configure(id)` 打开的界面中填写地址与密钥；密钥存于系统安全存储，插件无法读取。

## 本地化

- 清单中 `name`、`description` 与 `contributes` 下的任意字符串都可写成 `"%key%"`。
- `locales/<语言标签>.json`（如 `zh-CN.json`、`en.json`）为扁平的字符串对象。
- 每个 `%key%` 必须在 **每一个** locale 文件中存在，否则 `validate` 失败；使用了 `%key%` 却没有 `locales/` 目录也会失败。
- 代码中的文本使用同一套 locale 文件，插值为 `{{name}}`：`t('panel.chapter', { title })`。

## 包体限制

| 项目       | 上限    |
| ---------- | ------- |
| 压缩包     | 10 MiB  |
| 展开后总量 | 30 MiB  |
| `main.js`  | 2 MiB   |
| 单个文件   | 8 MiB   |
| 文件数     | 500     |
| 目录深度   | 8       |
| 图标 PNG   | 512 KiB |

路径大小写或 Unicode 规范化后冲突的文件会被拒绝。
