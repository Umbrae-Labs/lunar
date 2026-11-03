# 运行时 API 参考

类型签名以 `packages/plugin-sdk/src/types.ts`、`index.ts`、`ui.ts` 为准。本文件说明用法、权限与限制。

## 插件定义

```ts
import { definePlugin } from '@umbrae-labs/lunar-plugin-sdk';

export default definePlugin({
  async migrate({ from, to, storage, settings, log }) {
    // 仅在存储数据版本 ≠ 清单 dataVersion 时调用；降级时 from > to
  },
  activate(ctx) {
    // 注册命令、插槽、路由、事件、拦截器
  },
  deactivate() {
    // 可选，1 秒内完成
  },
});
```

`migrate` 在 `activate` 之前运行，期间插件没有任何注册。宿主先备份插件存储；`migrate`（10 秒上限）或更新后首次 `activate` 失败时恢复数据与旧版本。数据版本不一致而未定义 `migrate` 时激活失败。

## ctx（PluginContext）

| 成员                 | 用途                                                                                                         | 权限                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------- |
| `plugin`             | `id`、`version`、`generation`、`source`（official / community / development）                                | —                    |
| `host`               | `sdkVersion`、`appVersion`、`platform`、`locale`、`colorScheme`、`capabilities`                              | —                    |
| `subscriptions`      | 推入 `{ dispose() }`，随插件注册一起释放                                                                     | —                    |
| `commands`           | `register(id, handler)`、`execute(id, args?)`                                                                | —                    |
| `ui`                 | 插槽、路由、面板、toast、confirm                                                                             | —                    |
| `reader`             | 事件、拦截器、会话、装饰                                                                                     | 按方法，见下文       |
| `settings`           | `get(key)`（同步）、`set(key, value)`、`onChange(key, fn)`                                                   | —                    |
| `storage`            | 插件私有 JSON KV                                                                                             | —                    |
| `library`            | `importEpub({ fileName, bytes, onProgress? })`                                                               | `library.import`     |
| `network`            | `request({ url, method?, headers?, body?, responseType?, timeoutMs?, signal?, credential? })`、`stream(...)` | `network`            |
| `credentials`        | `get(id)`、`onChange(id, fn)`、`configure(id)`；只返回状态与地址，不返回密钥                                 | `network` + 清单凭据 |
| `services.clipboard` | `setText(text)`                                                                                              | —                    |
| `i18n`               | `locale`、`t(key, params?)`                                                                                  | —                    |
| `log`                | `info` / `warn` / `error`；开发连接时输出到 `lunar-plugin dev` 终端                                          | —                    |

所有注册方法返回 `Disposable`，宿主同时自动追踪，通常无需手动释放。

### 命令

```ts
ctx.commands.register('open-panel', ({ source, args, signal }) => ctx.ui.openPanel('main'));
```

`source` 为 `toolbar | panel | selection | route | plugin`。长任务监听 `signal`。

### 界面

```ts
ctx.ui.registerSlot('reader.panel', 'main', MainPanel); // 组件收到 { slotId, close? }
ctx.ui.registerRoute('book', BookScreen); // 组件收到 { pageId, params }
ctx.ui.openPanel('main');
ctx.ui.closePanel();
ctx.ui.openRoute('book', { id: '42' }); // params 只能是字符串
ctx.ui.toast(t('saved'), 'success'); // default | success | danger
const ok = await ctx.ui.confirm({ title, message, confirmLabel, cancelLabel, destructive: true });
```

### 阅读

```ts
ctx.reader.on('locationChange', ({ book, location }) => {});
```

| 事件               | 负载                                                 |
| ------------------ | ---------------------------------------------------- |
| `open`             | `book`                                               |
| `ready`            | `book`、`location`                                   |
| `locationChange`   | `book`、`location`（连续翻页时合并，只保证最终位置） |
| `chapterChange`    | `book`、`previous?`、`chapter?`                      |
| `selectionChange`  | `book`、`hasSelection`                               |
| `layoutChange`     | `book`、`location`（排版、字体、视口变化）           |
| `paginationChange` | `book`、`totalPages?`、`complete`                    |
| `close`            | `book`、`location?`                                  |

插件在会话开始后才激活时，宿主补发当前会话的 `open` 与 `ready`。

`ctx.reader.session`：

| 方法                                                                          | 权限                    | 说明                                                                     |
| ----------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `current()` / `subscribe(fn)`                                                 | `reader.events`         | 当前会话快照：`book`、`phase`、`location`、`interaction`、`hasSelection` |
| `getToc()`                                                                    | `reader.events`         | 目录树                                                                   |
| `getVisibleText()`                                                            | `reader.content.read`   | 当前页 `TextSegment[]`（`text`、`range`、`key?`、`chapterRef?`）         |
| `getChapterText(ref?)`                                                        | `reader.content.read`   | 需 `reader.chapterText` 能力，当前不可用                                 |
| `search(query, { limit?, caseSensitive?, signal? })`                          | `reader.content.read`   | 最多 100 条结果                                                          |
| `readSelection(selectionRef)`                                                 | `reader.selection.read` | 选区快照，≤ 32,768 个 UTF-16 单元，引用 5 分钟内有效                     |
| `goTo({ locator } \| { chapterRef } \| { progress })`、`next()`、`previous()` | `reader.navigate`       | 当前交互不允许导航时返回 `false`                                         |

`range` 只对当前排版有效，用于装饰；需要持久识别文本时用 `key`。

装饰（`reader.decorations`）：

```ts
const layer = ctx.reader.decorations.create('long-sentences');
layer.set(segments.map((s) => ({ range: s.range, style: 'wavy', color: 'accent' })));
layer.clear();
```

`style`：`background | outline | underline | wavy`；`color`：`yellow | pink | purple | blue | green | accent`。每插件 4 层，每层 500 个装饰；同一层 100 ms 内的多次 `set` 由宿主合并延后应用。排版变化（`layoutChange`）后需重新获取 `range` 并重设装饰。

拦截器：

```ts
ctx.reader.intercept('selectionMenu', (items, { book }) => [
  ...items,
  { id: 'count', title: ctx.i18n.t('selection.count'), icon: 'text', onPress: (selection) => {} },
]);
ctx.reader.intercept('toolbarItems', (items, { book }) => items);
```

拦截器必须同步返回，单次预算 16 ms，连续超时后被跳过。`selectionMenu` 需要 `reader.selection.read`；宿主内置项可隐藏或重排，不可替换；每个插件最多加入 6 项。

### 设置与存储

```ts
const limit = ctx.settings.get<number>('longSentence'); // 同步读取，键须在清单声明
ctx.settings.onChange('longSentence', remeasure);

await ctx.storage.set('book:42', { characters: 10 });
await ctx.storage.update<number>('count', (n) => (n ?? 0) + 1); // 原子读改写，updater 必须同步
await ctx.storage.keys('book:');
```

同一插件的写入按调用顺序执行；`update` 返回 `undefined` 会删除键。值必须是 JSON。键 ≤ 200 字符，单值 ≤ 256 KiB，总量 ≤ 5 MiB，超出抛 `QUOTA_EXCEEDED`。

### 网络

```ts
const res = await ctx.network.request({ url, headers, timeoutMs: 15_000, signal });
res.status;
res.headers;
res.body;
res.json<T>();
const img = await ctx.network.request({ url: coverUrl, responseType: 'bytes' });
img.bytes; // Uint8Array
```

流式响应（需 `network.stream` 能力，SDK ≥ 0.1.5），适合 SSE：

```ts
const head = await ctx.network.stream({
  url,
  method: 'POST',
  body,
  signal,
  timeoutMs: 30_000, // 每次等待数据的上限，而非总时长
  onResponse: ({ status, headers }) => {},
  onText: (text) => parser.push(text), // UTF-8 已解码，按到达顺序
});
```

回调抛出的错误会终止请求并原样拒绝；单个流总时长上限 10 分钟。SSE 解析需自行处理跨分片的行与 CRLF 换行，参见 `plugins/ai-explain/src/sse.ts`。

只允许公网 HTTPS 地址，重定向到非 HTTPS 或本地地址的响应会被拒绝；请求不携带 Cookie。每插件同时最多 4 个请求，默认超时 30 秒，响应 ≤ 16 MiB，请求体 ≤ 1M 字符。设置 `Host`、`Cookie`、`Origin`、`Referer`、`Connection`、`Content-Length`、`Transfer-Encoding`、`Proxy-Authorization` 或 `Sec-*` 请求头会抛出 `INVALID_ARGUMENT`。

### 凭据

```ts
const status = ctx.credentials.get('api'); // { id, configured, baseUrl? }
await ctx.network.request({ url: `${status.baseUrl}/models`, credential: 'api' });
const next = await ctx.credentials.configure('api'); // 打开宿主密钥界面，关闭后兑现
```

宿主为声明了 `credential` 的请求添加清单中的 `header: prefix + 密钥`，且不跟随重定向。未设置时抛 `CREDENTIAL_REQUIRED`，URL 不在用户确认的地址之下时抛 `PERMISSION_DENIED`；插件自行设置同名请求头抛 `INVALID_ARGUMENT`。组件内可用 `useCredential(id)` 订阅状态。

### 书库导入

```ts
const book = await ctx.library.importEpub({ fileName: 'title.epub', bytes, onProgress: (p) => {} });
```

只用于用户主动请求的导入，单次 ≤ 100 MiB。

## Hooks（仅在插件组件内使用）

| Hook                        | 返回                                             |
| --------------------------- | ------------------------------------------------ |
| `usePlugin()`               | 当前插件的 `PluginContext`                       |
| `useReader(selector?)`      | 会话快照或选择器结果；选择器返回原始值或已有对象 |
| `useReaderEvent(event, fn)` | 组件生命周期内订阅阅读事件                       |
| `useSetting<T>(key)`        | `[value, setValue]`                              |
| `useStorage<T>(key)`        | `[value \| undefined, setValue, loaded]`         |
| `useCredential(id)`         | `CredentialStatus`，用户修改密钥后重新渲染       |
| `useTheme()`                | `colorScheme`、语义 `colors`、`spacing`          |
| `useT()`                    | 翻译函数 `t(key, params?)`                       |

组件也可以通过闭包使用 `activate` 中的 `ctx`，或在组件外创建 store 再用 React 的 `useSyncExternalStore` 订阅（见 `plugins/reading-stats/src/index.tsx`）。

## UI 组件（`@umbrae-labs/lunar-plugin-sdk/ui`）

所有属性都是语义值，宿主负责主题、深色模式、字体缩放与无障碍。间距 `Space`：`none | xs | sm | md | lg | xl`。

| 组件                | 主要属性                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Stack` / `Row`     | `gap`、`padding`、`align`、`justify`、`style`；`Row` 另有 `wrap`                                                           |
| `Surface`           | `padding`、`tone: default \| secondary`                                                                                    |
| `ScrollArea`        | `gap`、`padding`                                                                                                           |
| `Divider`           | —                                                                                                                          |
| `Text`              | `size: xs–xl`、`tone: default \| muted \| accent \| danger \| success`、`weight`、`align`、`numberOfLines`、`selectable`   |
| `Heading`           | `level: 1 \| 2 \| 3`                                                                                                       |
| `Markdown`          | `children`（CommonMark 字符串）；不显示图片，链接点击后由浏览器打开；需 `ui.markdown` 能力                                 |
| `Button`            | `children`（字符串）、`onPress`、`variant: primary \| secondary \| ghost \| danger`、`size`、`icon`、`disabled`、`loading` |
| `IconButton`        | `icon`、`accessibilityLabel`（必填）、`onPress`、`variant: ghost \| secondary`                                             |
| `Icon`              | `name`、`size`、`tone`                                                                                                     |
| `Pressable`         | `onPress`、`accessibilityLabel`、`disabled`、`style`，用于卡片等组合内容                                                   |
| `Image`             | `source: { uri }`（HTTPS，需 `network`）、`aspectRatio`、`rounded`                                                         |
| `TextField`         | `value`、`onChangeText`、`label`、`description`、`placeholder`、`multiline`、`keyboardType: text \| number`、`onSubmit`    |
| `Switch`            | `value`、`onValueChange`、`label`（必填）、`description`                                                                   |
| `Spinner`           | `size: sm \| md \| lg`                                                                                                     |
| `ProgressCircle`    | `value: 0–1`、`size`、`accessibilityLabel`                                                                                 |
| `EmptyState`        | `icon`、`title`、`description`、`action: { label, onPress }`                                                               |
| `PanelHeader`       | `title`、`subtitle`、`trailing`                                                                                            |
| `List` / `ListItem` | `ListItem`：`title`、`description`、`detail`、`icon`、`onPress`、`trailing`                                                |

设计文档中列出的 `Chip`、`Menu`、`Slider`、`Select`、`Sheet` 等尚未提供，以 `ui.ts` 导出为准。可以直接使用 `react-native` 基础组件，但主题与无障碍需自行处理：颜色从 `useTheme().colors` 取，禁止 `className`。

## 错误

SDK 调用失败时抛出带 `code` 与 `retryable` 的 `PluginError`：

`PERMISSION_DENIED` `CREDENTIAL_REQUIRED` `CAPABILITY_UNAVAILABLE` `INVALID_ARGUMENT` `INCOMPATIBLE_SDK` `MODULE_NOT_FOUND` `NO_ACTIVE_SESSION` `ANCHOR_UNAVAILABLE` `GRANT_EXPIRED` `QUOTA_EXCEEDED` `NETWORK_DENIED` `CANCELLED` `TIMEOUT` `GENERATION_ENDED` `INTEGRITY_FAILED` `MIGRATION_FAILED`

事件处理器中启动的异步任务以 `void task().catch((error) => ctx.log.warn('...', error))` 的形式处理失败，参见 `plugins/reading-stats/src/index.tsx`。

## 宿主行为与预算

| 项目             | 值                                   |
| ---------------- | ------------------------------------ |
| `activate`       | 1 秒，超时视为激活失败并撤销本批注册 |
| `deactivate`     | 1 秒                                 |
| `migrate`        | 10 秒                                |
| 同步拦截器       | 16 ms                                |
| 连续崩溃自动停用 | 10 分钟内 3 次                       |

组件渲染异常由宿主错误边界兜底，阅读继续工作；插件导致启动崩溃时下次启动进入安全模式。正式模式下插件更新在应用重启后生效。
