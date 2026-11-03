# Lunar 插件 SDK 设计

| 项目         | 内容                                                            |
| ------------ | --------------------------------------------------------------- |
| 文档状态     | 设计提案第二版，供开发与评审使用                                |
| 编写日期     | 2026-10-22                                                      |
| 代码参考     | Lunar 0.3.0，提交 `f7edd5e`                                     |
| 首期平台     | Android                                                         |
| 主要分发方式 | GitHub Releases 发布 APK；插件经用户添加的插件仓库或本地包安装  |
| SDK 目标     | TypeScript 与 TSX 开发接口，JavaScript 执行产物                 |
| 前版关系     | 取代 2026-10-05 版本的“隔离脚本与声明式界面”首期方案，见第 2 节 |

本文描述拟议的插件系统及其实现安排。文中的包名、类型和方法均为设计契约，当前仓库尚未实现这些接口。`@umbrae-labs/lunar-plugin-sdk` 与 `@umbrae-labs/lunar-plugin-cli` 为暂定名称，发布前确认包名可用性。

本文属于设计说明。现有工程约束继续以[代码分层约束](../architecture.md)、[业务包约束](../features.md)、[阅读内核约束](../reader.md)、[界面组件约束](../ui.md)和[主题约束](../theme.md)为准。文中的 `MUST` 表示拟议实现的必要条件，`SHOULD` 表示推荐取舍。

## 1. 目标与范围

Lunar 提供公开 SDK，使用户能够以代码扩展阅读器：向阅读界面加入自定义 React 界面，订阅阅读生命周期，介入宿主预留的扩展点，并调用宿主提供的阅读、书库与设备服务。

听书、AI 辅助、词典与书源等后续功能以官方插件形式发布，用户按需安装。官方插件与社区插件使用相同的 SDK 契约，宿主不为官方插件保留私有接口。

核心阅读、书库访问、插件停用和安全模式始终由宿主提供。任何插件故障时，用户仍可阅读本地书籍并管理插件。

### 1.1 功能边界

| 能力       | 设计范围                                                        |
| ---------- | --------------------------------------------------------------- |
| 自定义界面 | 在宿主插槽中渲染插件提供的 React 组件，包括阅读面板、浮层与整页 |
| 生命周期   | 订阅书籍打开、关闭、位置变化、章节变化、选区与排版变化          |
| 扩展点     | 介入选区菜单、阅读工具栏、书籍操作等宿主预留的拦截点            |
| 页面装饰   | 以声明式范围与样式在正文上绘制高亮、下划线和波浪线              |
| 阅读能力   | 读取授权正文、导航、搜索、读写高亮与书签                        |
| 宿主服务   | 网络、凭据、存储、语音合成、音频播放等由宿主实现的命名服务      |
| 执行代码   | 经过构建的 JavaScript，运行于宿主 JavaScript 环境               |

[MUST] 插件发布物禁止包含 DEX、JAR、动态库、可执行程序或原生组件。插件所需的原生能力必须由宿主预置并以宿主服务形式提供。

[MUST] 插件的访问范围以公开 SDK 与宿主模块注册表为契约。应用数据库连接、MMKV 实例、Rito 对象、Skia 对象、Reanimated 共享值、手势对象和导航器实例不属于公开契约，宿主内部变更不承担对插件的兼容义务。

### 1.2 首期取舍

首期采用同进程执行与真实 React 界面。插件代码在应用的 Hermes 环境中执行，插件组件挂载在宿主组件树的插槽中，与宿主界面共享主题、字体缩放与无障碍设置。

该取舍以能力换取隔离强度：同进程插件拥有与应用相当的运行权限，宿主权限系统承担知情同意与接口闸门职责，不构成安全沙箱。插件来源、签名与用户信任共同构成首期的安全基础，具体边界见第 3 节。

面向不受信任来源的书源、刮削类脚本，规划独立的隔离执行层级，界面使用声明式协议，见第 13 节。两个层级共用非界面部分的 SDK 契约。

### 1.3 首期范围之外

插件间直接通信、插件依赖插件、插件自带原生模块、插件提供 Reanimated worklet、修改正文排版输入的内容改写钩子以及 iOS 平台暂缓提供。

## 2. 参考项目与采用方式

| 项目     | 插件执行位置                         | 界面扩展                      | 安全模型 |
| -------- | ------------------------------------ | ----------------------------- | -------- |
| Breeze   | QuickJS-NG，单文件脚本               | 声明式“Scheme + data”页面协议 | 隔离脚本 |
| vnite    | 宿主进程，注入数据库、事件总线与 IPC | 声明式配置项                  | 用户信任 |
| PotatoVN | 宿主进程，独立 `AssemblyLoadContext` | 注册 XAML 页面与侧栏按钮      | 用户信任 |

[vnite-plugin-sdk](https://github.com/ximu3/vnite-plugin-sdk/blob/main/src/types/plugin.ts)提供类型化的宿主 API、事件总线、配置描述和 `activate`/`deactivate` 生命周期。Lunar 采用其能力注入、类型包发布与脚手架方式，并为阅读场景重新定义事件与数据范围。

[PotatoVN](https://github.com/GoldenPotato137/PotatoVN/blob/dev/GalgameManager/Services/PluginService/PluginService.cs)以独立加载上下文装载插件，宿主框架程序集由默认上下文共享，插件可以注册页面与侧栏入口，停用时由宿主统一撤销。Lunar 采用其共享宿主依赖、插件注册界面与统一撤销的组织方式。

[Breeze](https://deretame.github.io/plugin-dev-docs/)以 QuickJS-NG 执行单文件 TypeScript 构建产物，界面采用声明式协议。Lunar 的隔离执行层级参考该方式。

前版设计以 Breeze 式隔离脚本作为首期唯一形态，无法满足插件自定义阅读界面的产品目标。本版将其调整为后续层级，签名、权限目录、网络策略、存储分工与错误契约继续沿用前版内容。

这些项目用于设计参考。后续采用第三方代码时，分别核对相应文件的许可证和分发义务。

## 3. 信任模型与执行层级

### 3.1 执行层级

| 层级        | 执行位置                 | 界面           | 适用对象                           | 阶段 |
| ----------- | ------------------------ | -------------- | ---------------------------------- | ---- |
| `full`      | 应用 Hermes 环境         | React 组件     | 官方插件、用户确认信任的社区插件   | 首期 |
| `sandboxed` | 独立进程中的嵌入式解释器 | 声明式组件协议 | 书源、刮削等不受信任来源的数据插件 | 后续 |

清单中的 `trust` 字段声明插件所需层级。`sandboxed` 层级实现之前，宿主拒绝安装声明该层级的插件。

### 3.2 同进程层级的边界

`full` 插件可以访问 JavaScript 全局对象，并可能经由宿主模块注册表之外的途径接触原生模块。宿主无法在同一 JavaScript 环境内阻止恶意代码绕过 SDK 接口。

宿主在该层级提供以下保证：

| 保证       | 实现方式                                           |
| ---------- | -------------------------------------------------- |
| 来源可识别 | 包签名、发布身份连续性、用户添加的仓库签名密钥     |
| 知情同意   | 安装界面展示执行层级、权限声明和网络来源           |
| 接口闸门   | SDK 接口按插件身份检查权限与资源预算               |
| 故障隔离   | 插槽错误边界、钩子异常捕获与超时、连续崩溃自动停用 |
| 可恢复     | 插件停用、安全模式启动、卸载时清理插件数据         |

[MUST] `full` 插件的安装与首次启用界面必须明确说明该插件以应用同等权限运行，权限声明用于说明用途，无法限制恶意行为。

[MUST] 宿主文案、权限界面与插件仓库不得将 `full` 层级描述为沙箱或隔离环境。

[SHOULD] 社区插件默认以“开发来源”或“第三方来源”标识，用户可以随时查看其签名指纹与来源地址。

### 3.3 官方插件与社区插件

Lunar 不内置任何插件仓库，也不预置受信任的发布密钥。所有插件仓库由用户自行添加，添加仓库即确认信任该仓库的签名密钥；由项目维护者发布的插件同样通过用户添加的仓库分发，宿主不区分官方与社区来源的信任等级。

[MUST] 应用不得内置默认插件仓库或默认受信任密钥，也不得在用户未确认的情况下添加仓库。

[MUST] 官方插件只使用公开 SDK 与宿主模块注册表。官方插件所需的新能力必须先成为公开契约，社区插件以相同条件获得该能力。

## 4. 当前代码基础与模块职责

### 4.1 当前状态

[app-tabs.tsx](../../apps/mobile/src/components/ui/app-tabs.tsx)固定声明书库和设置入口。

阅读业务已按插件接入需要完成重构，扩展点契约以阅读业务公开入口为准：

| 能力       | 当前实现                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 生命周期   | [会话事件](../../apps/mobile/src/features/reader/domain/reader-session-events.ts)从运行时快照派生，阅读位置保存与阅读时长订阅同一事件流                  |
| 会话访问   | [会话端口](../../apps/mobile/src/features/reader/domain/reader-session-port.ts)提供状态订阅、目录、可见文本、搜索与受交互状态约束的导航                  |
| 交互状态   | [阅读交互](../../apps/mobile/src/features/reader/domain/reader-interaction.ts)统一给出页面手势、内容打开与导航能力                                       |
| 面板与操作 | 阅读面板、顶部工具栏操作与选区操作均为描述符列表，内置项与扩展项共用结构                                                                                 |
| 页面装饰   | [页面叠加层](../../apps/mobile/src/reader/skia/rendering/reader-overlays.ts)按来源合并，插件装饰作为独立来源接入，样式包含背景填充、描边、下划线与波浪线 |
| 页面文本   | [文本句段](../../apps/mobile/src/reader/interaction/text-segments.ts)从当前帧命中数据切分句子，并按页内范围、来源范围与文本依次定位                      |

Rito 当前没有章节全文接口，阅读内核只能取得已分页帧的文本。章节全文需要在 fork 的 `lunar` 分支新增接口并发布 `rito-rn` 版本。

设置持久化使用[共享 MMKV 适配器](../../apps/mobile/src/stores/mmkv-state-storage.ts)。插件相关设置继续遵循该机制，业务记录使用所属仓储与 SQLite。

### 4.2 拟议模块

| 模块                                     | 职责                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `packages/plugin-sdk`                    | 公开类型、`definePlugin`、React Hooks、界面组件声明与清单 Schema |
| `packages/plugin-cli`                    | 项目生成、构建、清单检查、打包、签名与开发服务                   |
| `apps/mobile/src/features/plugins`       | 安装管理、加载器、模块注册表、注册表、权限、插槽渲染与管理界面   |
| `apps/mobile/src/features/reader`        | 阅读扩展点契约、插槽位置、阅读能力适配                           |
| `apps/mobile/src/features/library`       | 书籍操作扩展点、受管下载文件接收、EPUB 校验与导入                |
| `apps/mobile/src/features/audio`         | 拟新增的音频业务域，管理播放会话、后台播放与媒体控制             |
| `apps/mobile/src/stores/plugin-store.ts` | 插件启用偏好、入口固定与排序、声明式设置                         |
| `apps/mobile/src/app`                    | 装配扩展点实现、插件路由与应用导航                               |
| `plugins/<name>`                         | 官方插件，使用与社区插件相同的 CLI 和 SDK                        |

[MUST] SDK 包保持平台无关，运行时实现由宿主注入。插件包禁止引用应用内部文件，SDK 包禁止依赖 `apps/mobile`。

[MUST] 插件业务域的内部实现保持私有；其他业务域只通过扩展点契约与插件系统协作。

### 4.3 依赖方向

阅读与书库业务需要渲染插件内容，插件业务需要调用阅读与书库能力。为避免业务包循环依赖，扩展点契约由提供扩展位置的业务域定义，插件业务实现该契约，应用层完成装配。

```text
features/reader   定义 ReaderExtensionHost 契约与 ReaderExtensionProvider
       ▲                         ▲
       │ 公开入口                │ 实现契约
features/plugins  ───────────────┘  依赖 reader、library 公开入口构建插件 API
       ▲
       │ 注入 Provider
     app/_layout.tsx
```

[MUST] `apps/mobile/src/features/reader` 与 `apps/mobile/src/features/library` 只依赖自身定义的扩展点契约，禁止引用 `apps/mobile/src/features/plugins`。

[MUST] 扩展点契约只传递插件身份、插槽标识、渲染函数与命令描述，禁止暴露阅读内核内部身份。

[SHOULD] `app-tabs.tsx` 中的应用导航装配职责迁入应用装配层，共享导航外观可以保留为通用 UI 组件。

## 5. 执行环境

### 5.1 加载流程

1. 安装器完成包结构、完整性、签名与兼容范围检查，记录入口文件摘要。
2. 激活事件触发后，加载器读取入口文件并再次核对摘要。
3. 加载器以 CommonJS 包装函数执行入口代码，传入受控的 `require`、`module` 与 `exports`。
4. 加载器取得默认导出的插件定义，创建绑定插件身份的 `PluginContext`，调用 `activate`。
5. `activate` 期间产生的注册暂存为一批；激活成功后整体生效，失败时整体撤销。

[MUST] 加载器仅执行安装验证完成且摘要匹配的入口文件。运行期间禁止安装依赖、加载远程模块和加载包外文件。

[MUST] 宿主执行插件代码之前须确认插件处于启用状态，且未处于安全模式。

### 5.2 宿主模块注册表

插件构建时将宿主模块标记为外部依赖，执行时由受控 `require` 返回宿主实例。插件与宿主共享同一份 React，React Hooks 与 Context 可以跨越插件边界工作。

| 模块                               | 内容                        | 版本策略                    |
| ---------------------------------- | --------------------------- | --------------------------- |
| `react`                            | 宿主 React                  | 随 SDK 主版本锁定主版本     |
| `react/jsx-runtime`                | JSX 运行时                  | 同 `react`                  |
| `react-native`                     | 宿主 React Native           | 随 SDK 主版本锁定次版本范围 |
| `@umbrae-labs/lunar-plugin-sdk`    | 插件上下文、Hooks、类型工具 | 语义化版本                  |
| `@umbrae-labs/lunar-plugin-sdk/ui` | 宿主界面组件与主题工具      | 语义化版本                  |

[MUST] 受控 `require` 只解析注册表中的模块名称，其余名称抛出 `MODULE_NOT_FOUND`。

[MUST] 插件直接引用 `heroui-native`、`uniwind`、`react-native-reanimated`、`@shopify/react-native-skia` 和 `@umbrae-labs/rito-rn` 时构建失败。这些依赖的升级不受插件兼容性约束。

[SHOULD] 新增注册表模块须经过版本策略评审。注册表中的每个模块均属于公开契约，宿主升级该依赖时需要同步评估 SDK 主版本。

### 5.3 构建目标

插件入口为单文件 CommonJS 产物，纯 JavaScript 依赖由构建工具合并到入口文件中。构建目标为宿主 Hermes 支持的语法子集，SDK 随版本发布实际运行环境清单。

[MUST] 构建工具拒绝 Node.js 内置模块、原生依赖、动态 `import()`、顶层 `await` 与未登记的外部模块。

[MUST] 首期构建工具拒绝包含 worklet 指令的代码。插件需要的动画由 `@umbrae-labs/lunar-plugin-sdk/ui` 的组件提供。

### 5.4 激活事件

未被激活的插件只登记清单中的静态入口，不执行代码。用户使用插件贡献的任一入口时，宿主隐式激活该插件：调用命令、打开面板或整页、阅读器渲染插件浮层、打开插件设置页。清单中的激活事件只声明需要提前执行的场景。

| 激活事件       | 触发时机                    |
| -------------- | --------------------------- |
| `onStartup`    | 应用完成插件记录加载之后    |
| `onReaderOpen` | 任意书籍进入 `opening` 阶段 |

[SHOULD] 插件优先依赖隐式激活，仅在需要观察完整阅读会话时声明 `onReaderOpen`。`onStartup` 计入启动预算，管理界面展示各插件的激活耗时。

[MUST] 插件在阅读会话开始之后才激活时，宿主向该插件补发当前会话的 `open` 与 `ready` 事件。

### 5.5 停用与重载

同一 JavaScript 环境无法回收已经执行的模块代码。停用插件会撤销全部注册、取消在途任务并卸载插件组件，模块代码占用的内存在应用重启后释放。

[MUST] 正式模式下更新插件版本需要重启应用后生效。开发模式允许在同一进程内重新执行新版本入口，宿主先完整撤销旧代次的注册。

[MUST] 每次执行使用新的代次编号。旧代次的回调、定时器结果与异步响应在代次结束后由宿主丢弃。

### 5.6 故障隔离

| 故障类型              | 宿主处理                                               |
| --------------------- | ------------------------------------------------------ |
| 插槽组件渲染异常      | 插件级错误边界显示替代内容与停用入口，宿主界面继续工作 |
| 事件处理器抛出异常    | 记录诊断信息，后续事件继续派发                         |
| 拦截钩子异常或超时    | 跳过该钩子，使用上一环节结果                           |
| `activate` 异常或超时 | 撤销本批注册，执行状态置为 `failed`                    |
| 连续崩溃              | 达到阈值后自动停用并通知用户                           |
| 插件导致应用启动崩溃  | 下次启动进入安全模式                                   |

[MUST] 每个插槽内的插件组件由插件级错误边界包裹，错误边界归属宿主。

[MUST] 宿主记录插件执行期间的启动标记。上次启动在插件激活阶段异常退出时，应用以安全模式启动，所有插件保持停用，并由用户逐个恢复。

[MUST] 插件管理页提供“下次启动时进入安全模式”的入口。启动画面由原生层绘制，手势入口待启动画面支持交互后补充。

## 6. 插件包与发布身份

### 6.1 文件结构

插件包扩展名为 `.lunar-plugin`，内容为 ZIP 容器。

```text
reading-helper.lunar-plugin
  manifest.json
  main.js
  assets/
    icon.png
  locales/
    zh-CN.json
    en.json
  integrity.json
  signature.json
  LICENSE
```

[MUST] 安装器限制压缩包大小、展开大小、条目数量和目录深度，并拒绝绝对文件名、上级目录转义、符号链接、重复条目及大小写规范化后的冲突。

### 6.2 清单示例

```json
{
  "manifestVersion": 1,
  "id": "org.example.reading-helper",
  "name": "阅读助手",
  "version": "0.1.0",
  "sdk": "^1.0.0",
  "trust": "full",
  "platforms": ["android"],
  "main": "main.js",
  "publisherKeyId": "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k",
  "dataVersion": 1,
  "activationEvents": ["onReaderOpen"],
  "permissions": [
    { "name": "reader.content.read", "reason": "统计当前章节字数" },
    { "name": "reader.decorations", "reason": "标记长句" }
  ],
  "contributes": {
    "commands": [{ "id": "open-stats", "title": "%command.openStats%", "icon": "chart" }],
    "slots": {
      "reader.toolbar": [{ "id": "stats-button", "command": "open-stats" }],
      "reader.panel": [{ "id": "stats", "title": "%panel.stats%", "icon": "chart" }]
    },
    "settings": [
      {
        "key": "longSentence",
        "type": "number",
        "title": "%setting.longSentence%",
        "default": 80,
        "min": 20,
        "max": 300
      }
    ]
  }
}
```

示例中的名称、权限用途和发布密钥标识仅用于说明。`%key%` 形式的文本从 `locales` 中解析。清单字段采用封闭 Schema 校验，未知权限、未知插槽与未知激活事件使安装验证失败。

`contributes` 描述宿主可在插件未执行时展示的静态入口。插件代码通过注册接口为这些入口绑定行为与组件。

[MUST] 运行时注册的命令、插槽项与页面标识必须存在于清单中。标题、图标与权限范围以安装时验证的清单为准。

### 6.3 校验与签名

`integrity.json` 保存清单、源码和资源的 SHA-256。签名覆盖 `integrity.json` 的原始字节；哈希清单覆盖包内所有业务文件，并排除自身与签名文件，防止自引用。哈希清单的规范化字节编码由 CLI 与宿主共享 `@umbrae-labs/lunar-plugin-sdk/package-format` 的实现。

签名与密钥只采用标准格式，不定义私有变体：

| 对象       | 格式                                                                |
| ---------- | ------------------------------------------------------------------- |
| 签名算法   | 纯 Ed25519（RFC 8032），宿主按严格规则验证，不接受 ZIP-215 宽松编码 |
| 私钥文件   | PKCS#8 PEM（RFC 5958、RFC 8410），只由发布者保管                    |
| 公钥       | JSON Web Key，`kty: "OKP"`、`crv: "Ed25519"`（RFC 8037）            |
| 密钥标识   | JWK SHA-256 指纹（RFC 7638），即 `publisherKeyId` 与 `keyId` 的取值 |
| 二进制字段 | 无填充 base64url（RFC 4648 第 5 节）                                |

`signature.json` 包含 `format: 1`、`algorithm: "Ed25519"`、签名密钥的 `keyId` 与 64 字节签名。CLI 使用 Node.js 内置加密模块签名，宿主使用 `@noble/curves` 验证；两端以 RFC 8037 附录 A 的测试向量互相校验。

[MUST] 只有密钥属于用户已添加仓库的签名才视为已验证；签名密钥未知时按未签名包处理。签名声明的 `keyId` 属于已添加仓库但验证失败时，安装器拒绝该包。

[MUST] 安装器记录通过验证的签名密钥。同一插件标识的后续版本必须由该密钥签署；需要更换发布者时，用户先卸载插件再安装新包。

[MUST] 清单声明 `publisherKeyId` 时，包必须带有该密钥标识的签名。

首次安装展示作者声明、来源、签名验证结果、执行层级和请求权限。签名证明包的完整性及发布身份连续性，无法证明插件行为安全。

[MUST] 未经已添加仓库密钥验证的插件包只能在开发者模式下安装，安装界面说明发布者无法验证。

### 6.4 插件仓库

插件仓库是一份可从任意 HTTPS 静态站点访问的索引文件，通常命名为 `index.json`，与插件包、图标一起发布。`lunar-plugin keygen` 生成签名私钥，`lunar-plugin pack --key` 生成签名包，`lunar-plugin catalog` 校验每个包均由仓库密钥签署后写出索引、`packages/` 与 `icons/`。

```json
{
  "format": 1,
  "name": "示例仓库",
  "badge": "EX",
  "website": "https://example.com",
  "signingKey": { "kty": "OKP", "crv": "Ed25519", "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" },
  "plugins": [
    {
      "id": "org.example.reading-helper",
      "name": "阅读助手",
      "version": "0.1.0",
      "sdk": "^0.1.0",
      "package": "packages/org.example.reading-helper-0.1.0.lunar-plugin",
      "icon": "icons/org.example.reading-helper.png",
      "sha256": "…",
      "size": 18342,
      "permissions": ["reader.content.read"],
      "locales": { "en": { "name": "Reading helper" } }
    }
  ]
}
```

包与图标地址相对索引地址解析，也可以是绝对 HTTPS 地址。宿主忽略索引中未知的字段，以便仓库格式向后兼容地扩展。

用户在插件设置的“插件仓库”分组中输入索引地址，或打开 `lunar://add-catalog?url=<索引地址>` 链接添加仓库。添加前宿主读取索引并展示仓库名称、地址、插件数量与签名密钥标识，由用户确认信任。

[MUST] 仓库只通过 HTTPS 访问。下载的插件包须与索引声明的字节数和 SHA-256 一致，再经过完整的包校验与签名验证。

[MUST] 添加仓库时固定其签名密钥。之后读取到的索引声明其他密钥时，宿主停止使用该仓库并提示用户；用户确认变更后移除并重新添加仓库。

[MUST] 宿主按 SDK 兼容范围标记不兼容的插件，按版本号比较提示可用更新。已安装插件只接受与其安装时签名密钥相同的仓库提供的更新。

[SHOULD] 移除仓库不卸载已安装插件；在重新添加仓库前，这些插件无法通过仓库更新。

## 7. SDK 基础契约

以下 TypeScript 片段定义接口形态，完整声明文件由 SDK 实现阶段提供。正式包需要包含 Schema、错误代码、能力版本和每个方法的权限说明。

### 7.1 插件定义与上下文

```ts
interface Disposable {
  dispose(): void;
}

interface PluginDefinition {
  activate(ctx: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
  migrate?(ctx: MigrationContext): Promise<void> | void;
}

interface MigrationContext {
  readonly plugin: { id: string; version: string; generation: number };
  readonly from: number;
  readonly to: number;
  readonly storage: StorageAPI;
  readonly settings: SettingsAPI;
  readonly log: LogAPI;
}

interface PluginContext {
  readonly plugin: { id: string; version: string; generation: number };
  readonly host: HostInfo;
  readonly subscriptions: Disposable[];
  readonly commands: CommandsAPI;
  readonly ui: UIAPI;
  readonly reader: ReaderAPI;
  readonly library: LibraryAPI;
  readonly settings: SettingsAPI;
  readonly storage: StorageAPI;
  readonly network: NetworkAPI;
  readonly credentials: CredentialsAPI;
  readonly services: HostServicesAPI;
  readonly i18n: I18nAPI;
  readonly log: LogAPI;
}

interface HostInfo {
  sdkVersion: string;
  appVersion: string;
  platform: 'android';
  locale: string;
  colorScheme: 'light' | 'dark';
  capabilities: Readonly<Record<string, number>>;
}

declare function definePlugin(definition: PluginDefinition): PluginDefinition;
```

`activate` 完成注册与轻量初始化。耗时任务应在激活完成后由命令、事件或插槽组件启动。

[MUST] 所有注册接口返回 `Disposable`，宿主同时自动追踪全部注册。插件停用、代次结束或激活失败时，宿主撤销该插件的全部注册；重复释放视为成功。

[MUST] `PluginContext` 的每个接口都绑定宿主确定的插件身份与代次，插件无法以参数指定其他插件身份。

### 7.2 命令

```ts
interface CommandContext {
  source: 'toolbar' | 'panel' | 'selection' | 'bookAction' | 'route' | 'plugin';
  args?: unknown;
  signal: AbortSignal;
}

interface CommandsAPI {
  register(id: string, handler: (context: CommandContext) => Promise<void> | void): Disposable;
  execute(id: string, args?: unknown): Promise<void>;
}
```

命令是插件行为的统一入口。清单中的工具栏按钮、选区菜单项与书籍操作都通过命令标识绑定行为。

[MUST] `execute` 只能调用本插件命令与宿主公开的 `lunar.*` 命令。宿主命令目录随 SDK 版本发布。

### 7.3 设置与存储

```ts
interface SettingsAPI {
  get<T>(key: string): T;
  set<T>(key: string, value: T): Promise<void>;
  onChange(key: string, listener: (value: unknown) => void): Disposable;
}

interface StorageAPI {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  update<T>(key: string, updater: (current: T | undefined) => T | undefined): Promise<T | undefined>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}
```

`settings` 读写清单声明的设置字段，宿主执行类型与范围校验，并在插件设置页自动生成表单。旧版本清单下保存、已不满足当前声明的设置值按默认值读取。`storage` 提供插件专属 JSON KV，用于业务数据。

[MUST] 同一插件的存储写入按调用顺序依次执行。`update` 在一次写入内完成读取、变换与写回，变换函数必须同步返回；返回 `undefined` 时删除该键。

### 7.4 国际化与日志

`i18n.t` 从插件 `locales` 中解析文本，并跟随宿主语言。`log` 写入插件诊断日志，日志在插件管理页可查看与导出。

[MUST] 宿主日志与诊断导出默认清除正文、凭据与请求体内容。

## 8. 阅读生命周期与阅读能力

### 8.1 生命周期事件

事件派生自阅读运行时快照，在快照提交并到达订阅方之后派发。

| 事件               | 触发时机                                 | 主要数据                   |
| ------------------ | ---------------------------------------- | -------------------------- |
| `open`             | 书籍进入 `opening` 阶段                  | 书籍引用、元数据           |
| `ready`            | 首次进入 `ready` 阶段                    | 书籍引用、目录、初始位置   |
| `locationChange`   | 页面导航完成且目标画面已呈现             | 定位符、章节、全书进度     |
| `chapterChange`    | 当前章节标识变化                         | 前后章节                   |
| `selectionChange`  | 用户选区建立、变化或清除                 | 选区引用、是否为空         |
| `layoutChange`     | 排版、字体、纸页颜色或视口变化导致新修订 | 排版摘要，不含内部修订标识 |
| `paginationChange` | 后台分页进度或完成状态变化               | 总页数是否确定、完成状态   |
| `controlsChange`   | 阅读控件显示或隐藏                       | 是否可见                   |
| `close`            | 书籍进入 `closing` 阶段                  | 书籍引用、最后位置         |

```ts
interface ReaderAPI {
  on<E extends keyof ReaderEvents>(event: E, listener: (payload: ReaderEvents[E]) => void): Disposable;
  intercept<P extends keyof ReaderInterceptors>(point: P, handler: ReaderInterceptors[P]): Disposable;
  readonly session: ReaderSessionAPI;
  readonly decorations: DecorationsAPI;
}
```

[MUST] 事件派发不得进入翻页手势、动画帧回调与原生 composer 事件处理路径。宿主在 JavaScript 线程的空闲时机批量派发事件。

[MUST] 连续翻页期间 `locationChange` 允许合并，插件只保证收到最终位置。

[MUST] 事件数据使用书籍引用、定位符与章节标识表达位置。`spreadIndex`、`renderId`、修订标识与分页工件属于阅读内核内部身份，不进入 SDK。

### 8.2 拦截点

拦截点允许插件在宿主指定位置修改结果。多个插件按用户排序串联执行，每个处理器接收上一环节的输出。

| 拦截点          | 输入与输出             | 用途                     |
| --------------- | ---------------------- | ------------------------ |
| `selectionMenu` | 菜单项列表与选区引用   | 添加、隐藏或重排选区操作 |
| `toolbarItems`  | 工具栏项目列表         | 调整插件按钮位置         |
| `excerptExport` | 摘录分享内容与样式描述 | 追加署名、修改分享文本   |
| `tocItems`      | 目录项列表             | 为目录项附加标记         |

```ts
interface ReaderInterceptors {
  selectionMenu(items: readonly MenuItem[], context: { selectionRef: string; bookRef: string }): readonly MenuItem[];
  toolbarItems(items: readonly ToolbarItem[]): readonly ToolbarItem[];
  excerptExport(content: ExcerptContent): ExcerptContent | Promise<ExcerptContent>;
  tocItems(items: readonly TocItem[]): readonly TocItem[];
}
```

[MUST] 拦截点由宿主封闭定义，插件无法创建新的拦截点。同步拦截点的单次执行预算见第 15 节，超时的处理器被跳过。

[MUST] 拦截结果必须通过宿主 Schema 校验。宿主内置菜单项可以被隐藏，禁止被替换为同标识的插件项。

### 8.3 阅读内容与导航

```ts
interface ReaderSessionAPI {
  current(): ReaderSessionInfo | undefined;
  getVisibleText(): Promise<TextSegment[]>;
  getChapterText(chapterRef?: string): Promise<TextSegment[]>;
  readSelection(selectionRef: string): Promise<SelectionSnapshot>;
  search(query: string, options?: { signal?: AbortSignal }): Promise<SearchHit[]>;
  goTo(target: { locator: string } | { chapterRef: string } | { progress: number }): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  highlights: HighlightsAPI;
  bookmarks: BookmarksAPI;
}

interface TextSegment {
  text: string;
  range: string;
  key?: string;
  chapterRef: string;
}
```

`TextSegment.key` 是与排版无关的文本身份，由书籍、章节文档与来源范围计算。同一句文字在翻页、重排与再次打开书籍后保持相同的键，插件据此去重与累计。宿主无法确定来源范围时不提供该字段。`range` 只对当前排版有效，不得作为持久身份。

`TextSegment.range` 是宿主生成的来源范围引用，可用于装饰、高亮、定位与听书跟读。宿主可以在能够确定来源范围时生成该引用；无法确定时返回 `ANCHOR_UNAVAILABLE`。

[MUST] `getChapterText` 依赖 Rito 章节全文接口。接口就绪之前，该方法返回 `CAPABILITY_UNAVAILABLE`，`host.capabilities` 不报告 `reader.chapterText`。

[MUST] 文字范围继续采用阅读内核的来源节点与 UTF-16 偏移语义。插件获得的展示文本保留段落，宿主内部的查询文本规范与展示文本分别处理。

[MUST] 范围引用包含格式版本与书籍内容身份。书籍内容变更后，宿主验证或迁移引用；无法确认对应关系时返回 `ANCHOR_UNAVAILABLE`。

[MUST] 插件写入的高亮与书签归属宿主阅读业务，并记录来源插件。插件卸载后这些用户记录继续保留。

### 8.4 页面装饰

```ts
interface Decoration {
  range: string;
  style: 'background' | 'outline' | 'underline' | 'wavy';
  color: SemanticDecorationColor;
}

interface DecorationsAPI {
  create(layerId: string): DecorationLayer;
}

interface DecorationLayer extends Disposable {
  set(decorations: readonly Decoration[]): void;
  clear(): void;
}
```

插件以声明式范围与样式描述装饰，宿主解析几何并通过现有页面叠加层绘制。装饰层按插件与图层标识隔离，宿主统一控制绘制顺序。

[MUST] 插件无法获得 Skia 画布、页面画面或文字几何。装饰样式限定在宿主支持的集合中，颜色使用宿主语义装饰色。

[MUST] 装饰集合变化时生成新的装饰版本，并参与页面画面与原生纹理缓存标识，旧外观的纹理不得复用。

[SHOULD] 高频装饰更新（例如听书跟读）以句段为单位提交，宿主对单个图层的更新频率限流。

### 8.5 性能约束

[MUST] 插件存在与否不得改变翻页手势、动画与原生 composer 的执行路径。插件影响阅读画面的唯一途径是页面装饰与 `reader.overlay` 插槽。

[MUST] `reader.overlay` 插槽默认不拦截正文区域的触摸事件，插件组件仅在自身可交互区域接收事件。

[SHOULD] 宿主记录各插件的事件处理耗时、插槽渲染次数与装饰更新频率，在插件管理页展示，并在超出预算时提示用户。

## 9. 界面扩展

### 9.1 插槽目录

| 插槽                   | 宿主位置             | 插件提供内容                  | 首期 |
| ---------------------- | -------------------- | ----------------------------- | ---- |
| `reader.toolbar`       | 阅读控件栏           | 绑定命令的图标按钮            | 是   |
| `reader.panel`         | 阅读标签栏与底部抽屉 | React 面板组件                | 是   |
| `reader.overlay`       | 阅读画面上方的界面层 | React 浮层组件                | 是   |
| `reader.selectionMenu` | 选区操作菜单         | 经拦截点加入的命令项          | 是   |
| `reader.settings`      | 排版与外观面板末尾   | React 设置分组                | 否   |
| `library.bookActions`  | 书籍详情与长按菜单   | 绑定命令的操作项              | 否   |
| `app.route`            | 通用插件路由         | 整页 React 组件               | 是   |
| `app.tab`              | 底部导航             | 指向插件路由的入口            | 是   |
| `settings.plugin`      | 插件设置页           | 自动表单，或自定义 React 组件 | 是   |

```ts
interface SlotProps {
  slotId: string;
  close?: () => void;
}

interface UIAPI {
  registerSlot(slot: SlotName, id: string, component: React.ComponentType<SlotProps>): Disposable;
  registerRoute(pageId: string, component: React.ComponentType<RouteProps>): Disposable;
  openPanel(id: string): void;
  openRoute(pageId: string, params?: Record<string, string>): void;
  toast(message: string, tone?: 'default' | 'success' | 'danger'): void;
  confirm(options: ConfirmOptions): Promise<boolean>;
}
```

[MUST] 阅读面板的宿主状态由封闭的内置面板集合扩展为“内置面板加插件面板引用”，插件面板引用由插件身份与清单标识组成。

[MUST] `app.route` 条目声明 `hidden: true` 时只作为插件内部导航目标，不出现在插件详情页的入口列表中；需要参数才能显示的详情页必须使用该标记并对缺失参数给出可恢复状态。

[MUST] 插件的入口页面为未声明 `hidden` 的 `app.route` 条目。插件管理页点击已启用且具有入口页面的插件时直接打开首个入口页面，插件信息与设置通过入口页面标题栏或长按条目进入。

[MUST] 插件具有多个入口页面时，宿主在同一页面内提供页面标签并保留已访问页面的状态；整页显示时标签位于底部，作为底部导航标签显示时标签位于标题下方。`app.route` 条目的 `icon` 用于页面标签。

[MUST] `app.tab` 每个插件至多声明一项，且只能指向入口页面。插件只声明入口，是否显示在底部导航由用户在插件详情页决定，宿主限制插件标签的总数并保持内置标签的位置。

[MUST] 插槽内的插件组件由宿主插件作用域 Provider 包裹，SDK Hooks 通过该 Provider 取得插件身份与上下文。

[MUST] 插件停用时，宿主先关闭其打开的面板、浮层与路由，再撤销注册。

### 9.2 界面组件包

`@umbrae-labs/lunar-plugin-sdk/ui` 提供宿主实现的界面组件。组件内部使用 HeroUI Native 与宿主主题，对插件公开稳定的属性集合。

| 类别 | 组件                                                                |
| ---- | ------------------------------------------------------------------- |
| 布局 | `Stack`、`Row`、`Surface`、`Divider`、`ScrollArea`                  |
| 文本 | `Text`、`Heading`、`Markdown`                                       |
| 操作 | `Button`、`IconButton`、`Pressable`、`Chip`、`Menu`                 |
| 输入 | `TextField`、`Switch`、`Slider`、`Select`、`SegmentedControl`       |
| 反馈 | `Spinner`、`ProgressCircle`、`Progress`、`EmptyState`、`ErrorState` |
| 容器 | `PanelHeader`、`List`、`ListItem`、`Sheet`                          |
| 媒体 | `Image`（按插件网络权限加载的 HTTPS 地址）、`Icon`                  |

[MUST] 界面组件只接受语义颜色、语义间距与语义字号，宿主统一处理浅色与深色主题、字体缩放、触控区域和无障碍角色。

[MUST] `Image` 只在插件声明 `network` 权限时加载图片，并与 `ctx.network` 采用相同的地址规则：仅限公网 HTTPS 地址，其余地址由宿主按占位块渲染。

[MUST] `Markdown` 按 CommonMark 渲染插件提供的文本，不显示图片，避免模型输出等外部文本借图片地址向第三方发起请求；链接仅在用户点击后由系统浏览器打开。

[SHOULD] 插件优先使用界面组件包。插件直接使用 `react-native` 基础组件时，由插件自行保证主题与无障碍质量。

### 9.3 样式

宿主使用 Uniwind，类名在应用构建时扫描生成。插件代码不参与宿主构建，任意类名在运行时不会产生样式。

| 方式         | 说明                                                                            |
| ------------ | ------------------------------------------------------------------------------- |
| 界面组件属性 | 推荐方式，覆盖主题、间距与状态                                                  |
| 公开工具类   | 宿主以 `@source inline` 登记的有限类名集合，随 SDK 版本发布；SDK 0.1 的集合为空 |
| `style` 属性 | 插件自定义布局，颜色通过 `useTheme()` 取得语义值                                |

[MUST] 公开工具类集合属于 SDK 契约。删除或改变已公开类名的含义需要增加 SDK 主版本。

[MUST] 构建工具对未公开的 `className` 字面量给出错误，避免插件在运行时静默失去样式。SDK 0.1 未公开工具类，构建工具拒绝插件源码中的全部 `className`。

宿主代码继续遵守禁止调用 `StyleSheet.create` 的约束；插件代码的样式方式由本节规定。

### 9.4 React Hooks

| Hook                    | 返回内容                                     |
| ----------------------- | -------------------------------------------- |
| `usePlugin()`           | 当前插件上下文                               |
| `useReader(selector?)`  | 当前阅读会话、章节、进度与阶段，按选择器订阅 |
| `useReaderEvent(e, fn)` | 在组件生命周期内订阅阅读事件                 |
| `useSetting(key)`       | 设置值与更新函数                             |
| `useStorage(key)`       | 插件存储值、加载状态与更新函数               |
| `useTheme()`            | 语义颜色、间距、字号与当前颜色模式           |
| `useT()`                | 插件文本翻译函数                             |

[MUST] `useReader(selector)` 只在选择器结果变化时重新渲染插件组件；选择器返回浅比较相等的对象时保持原有引用。

### 9.5 路由与底部导航

插件整页由随应用发布的通用路由承载，路径包含插件标识与页面标识。插件安装过程只增加注册记录，路由文件继续由应用构建管理。

一个插件可以注册多个页面，首期最多提供一个可固定的底部入口。书库和设置保留固定入口，其他扩展入口在统一扩展页中列出，用户可以选择固定到底部，整个应用最多展示五个底部入口。

多个插件页面的独立标签状态需要按 [Expo SDK 57 Router UI](https://docs.expo.dev/versions/v57.0.0/sdk/router/ui/) 验证同一路由模板对应多个标签的身份处理。现有实现无法表达所需身份时，应用层采用自定义导航器，SDK 契约保持不变。

### 9.6 图标

清单图标使用宿主图标目录中的名称，宿主映射到各平台符号。插件自身的图标也可以使用 `assets` 目录中的 PNG 资源，单个文件不超过 512 KiB，安装器校验文件存在与 PNG 格式。命令与插槽图标仅使用宿主符号。

```json
{ "icon": "chart" }
{ "icon": { "android": "query_stats", "ios": "chart.bar" } }
{ "icon": "assets/icon.png" }
```

## 10. 权限与数据授权

### 10.1 权限目录

安装时展示清单中的权限声明。SDK 接口在调用时检查权限，涉及正文外发与设备能力的权限在首次使用时再次确认。插件管理界面允许用户查看、撤销权限，并清除插件数据。

| 权限                    | 授权对象                                        | 默认有效范围 |
| ----------------------- | ----------------------------------------------- | ------------ |
| `reader.events`         | 阅读生命周期事件                                | 安装授权     |
| `reader.selection.read` | 用户点击插件操作时的选区快照                    | 本次操作     |
| `reader.content.read`   | 当前打开书籍的正文片段                          | 本次阅读会话 |
| `reader.navigate`       | 当前阅读会话的导航                              | 本次阅读会话 |
| `reader.decorations`    | 当前阅读会话的页面装饰                          | 本次阅读会话 |
| `library.import`        | 用户确认的单次 EPUB 导入                        | 本次导入任务 |
| `network`               | 经 `ctx.network` 与 `Image` 访问公网 HTTPS 地址 | 安装授权     |

插槽注册、命令注册、插件设置与插件专属存储属于基本能力，受清单、命名空间和容量限制。

[MUST] 权限目录只收录宿主已实现接口的权限。书库元数据、批注与音频等能力在接口实现时再加入权限目录；凭据通过清单 `contributes.credentials` 声明，不进入权限目录。

`network` 不按来源细分。`full` 插件可以直接使用全局 `fetch`，按来源授权无法约束插件，而图片与下载经常来自无法预先列举的 CDN 地址；因此网络权限只说明用途，由插件在 `reason` 中写明访问的服务。SDK 0.1.1 及更早版本的 `network:<origin>` 权限仍可加载并视为 `network`，CLI 不再构建这种写法。

权限属于 Lunar 的应用内授权模型。Android 系统权限由宿主申请，系统授予 Lunar 的权限不会自动通过 SDK 转交给插件。

### 10.2 执行层级与权限效力

`full` 层级中，权限检查约束 SDK 接口调用。插件仍可能使用 JavaScript 全局能力绕过检查，权限界面须按第 3.2 节如实说明。`sandboxed` 层级中，执行环境不提供 SDK 之外的入口，权限检查构成访问边界。

[MUST] 对象引用仅用于定位资源，每次访问仍需授权。`bookRef`、`selectionRef`、`range` 等引用单独出现时不构成访问许可。

[SHOULD] 宿主向远程服务发送正文、选区或笔记之前，若请求经由 `ctx.network` 发出，在首次使用时展示请求的服务域名与用途。

### 10.3 授权撤销的边界

宿主可以阻止后续读取并取消在途请求，插件此前取得的文本则可能留存在插件内存、存储或外部服务中。授权界面应准确说明访问范围和外发目的，避免承诺撤销可以回收全部数据。

## 11. 网络、凭据与存储

### 11.1 网络代理

```ts
interface NetworkRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  responseType?: 'text' | 'bytes';
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 清单声明的凭据标识 */
  credential?: string;
}

interface NetworkStreamRequest extends Omit<NetworkRequest, 'responseType'> {
  onResponse?(head: NetworkResponseHead): void;
  onText(text: string): void;
}

interface NetworkAPI {
  request(request: NetworkRequest): Promise<NetworkResponse>;
  stream(request: NetworkStreamRequest): Promise<NetworkResponseHead>;
}
```

`ctx.network` 提供地址检查、请求限额、凭据注入、插件独立 Cookie 存储、日志脱敏与流式响应。`full` 插件可以直接使用全局 `fetch`，此时这些能力不可用，插件管理页标记该插件存在未经代理的网络访问能力。

[MUST] 插件请求仅开放公网 HTTPS 地址，拒绝内网、回环、保留本地地址及云元数据地址，自托管服务通过单独权限开放。React Native 的网络层自行跟随重定向，宿主检查最终响应地址，重定向到非 HTTPS 或本地地址的响应不交给插件；请求不携带 Cookie 与平台凭据。

[MUST] 凭据注入只通过 `ctx.network` 生效。

[SHOULD] 官方插件只通过 `ctx.network` 访问网络，作为社区插件的实现示范。

AI 流式响应、书籍下载和音频结果通过有界流或宿主管理任务传送，宿主执行背压与总量限制。

`stream` 按到达顺序交付 UTF-8 解码后的响应文本，先交付状态与响应头，响应结束后兑现。`timeoutMs` 约束每次等待数据的时长，单个流另有总时长上限；响应总量、并发数与地址规则与 `request` 相同。插件回调抛出的错误终止请求并原样拒绝。宿主通过 `host.capabilities['network.stream']` 报告该能力。

[MUST] 流式响应由支持逐段读取响应体的宿主网络实现承载，宿主不得先缓存完整响应再分段交付。

### 11.2 凭据服务

插件在清单 `contributes.credentials` 中声明凭据：标识、名称、说明、注入的请求头与前缀，以及建议的服务地址。用户在宿主控制的凭据界面填写服务地址与密钥；插件只通过 `ctx.credentials` 读取是否已设置与服务地址，在请求中以 `credential` 指明凭据，由宿主附加 `请求头: 前缀 + 密钥`。

```ts
interface CredentialsAPI {
  get(id: string): CredentialStatus; // { id, configured, baseUrl? }
  onChange(id: string, listener: (status: CredentialStatus) => void): Disposable;
  configure(id: string): Promise<CredentialStatus>; // 打开宿主凭据界面
}
```

[MUST] SDK 只提供凭据选择、状态查询和授权使用，禁止返回密钥明文。密钥采用 Android Keystore 支持的加密存储，普通 MMKV 设置存储仅保存服务地址等非敏感信息。

[MUST] 宿主只向用户确认的服务地址及其下级路径发送密钥，并拒绝为携带凭据的请求跟随重定向。请求地址超出范围时返回 `PERMISSION_DENIED`，凭据未设置时返回 `CREDENTIAL_REQUIRED`。

[MUST] 用户把服务地址改到其他主机时必须重新输入密钥，已保存的密钥不随地址迁移到新的服务。

[MUST] 凭据注入的请求头不得是宿主控制的请求头，插件请求不得设置与凭据同名的请求头。

[MUST] 声明凭据的插件必须声明 `network` 权限。凭据不属于权限目录，清单中的凭据声明即说明其用途。

插件的密码类设置字段由宿主凭据界面接收，原始值不进入插件设置存储。卸载插件时宿主删除其全部密钥，保留业务记录的选项不保留密钥。

### 11.3 持久化分工

| 数据                                   | 归属与介质                                                    |
| -------------------------------------- | ------------------------------------------------------------- |
| 插件启用偏好、入口固定与排序、插件设置 | `apps/mobile/src/stores` 中的插件领域 store，共享 MMKV 适配器 |
| 安装版本、来源、签名、权限授予记录     | 插件业务仓储与 SQLite                                         |
| 插件专属业务记录                       | 插件业务仓储中的命名空间 KV                                   |
| 书籍、阅读位置、高亮与书签             | 原所属业务仓储，记录来源插件                                  |
| 插件包、下载缓存、音频缓存             | 所属业务文件服务                                              |
| 服务密钥                               | 宿主凭据服务                                                  |
| 插件代次、装饰层、在途请求             | 内存                                                          |

[MUST] 每次存储调用绑定宿主确定的插件身份，禁止插件指定其他插件的命名空间。写入操作检查单值大小与总容量。

卸载界面默认清除包、权限、凭据引用和插件专属数据；用户可以选择保留业务记录。导入书库的书籍及用户创建的阅读标注继续归属宿主。

## 12. 宿主服务与官方插件

### 12.1 原生能力清单

插件无法携带原生代码。官方插件计划使用的设备能力必须先在宿主中实现，以 `ctx.services` 下的命名服务公开，并通过 `host.capabilities` 报告版本。

| 宿主服务    | 内容                                             | 首个使用方 |
| ----------- | ------------------------------------------------ | ---------- |
| `speech`    | 系统语音引擎的音色列表、分段合成与时间标记       | 听书       |
| `audio`     | 播放队列、后台播放、音频焦点、媒体通知与锁屏控制 | 听书       |
| `clipboard` | 写入剪贴板                                       | 词典、AI   |
| `share`     | 系统分享                                         | 摘录类插件 |
| `haptics`   | 触感反馈                                         | 通用       |
| `downloads` | 受管下载任务与临时文件                           | 书源、模型 |

用户按需安装官方插件时，减少的是 JavaScript 代码、界面入口与下载资源（例如离线语音模型），原生依赖仍随应用发布。

[MUST] 宿主服务的原生实现归属对应业务域，`ctx.services` 只做身份绑定、权限检查与参数校验。

[SHOULD] 新宿主服务进入 SDK 之前，至少有一个官方插件完成真机验证。

### 12.2 听书

听书插件负责朗读界面、断句策略、语音服务选择与跟读高亮；宿主负责播放会话、后台执行与媒体控制。

1. 插件通过 `getChapterText` 取得带来源范围的文本片段，按句切分。该能力就绪之前，听书只能逐页使用 `getVisibleText`。
2. 插件调用 `services.speech` 或网络语音服务合成音频，并将片段提交给 `services.audio` 播放队列。
3. 播放进度事件携带片段标识，插件据此更新 `reader.decorations` 中的跟读图层。
4. 片段跨页时，插件调用 `reader.session.goTo` 跟随翻页。

[MUST] Android 后台听书由宿主音频服务保持。应用进入后台后插件的 JavaScript 可能暂停，播放队列须预先持有足够片段，或由宿主在恢复前台时请求后续片段。

[MUST] 时间标记使用输入片段内的 UTF-16 偏移，由宿主映射回来源范围。缺少时间标记时以片段为单位高亮。

当前依赖清单尚未包含音频播放与系统语音实现，需要评估 [Expo SDK 57 Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/) 与 [Expo SDK 57 Speech](https://docs.expo.dev/versions/v57.0.0/sdk/speech/)，并在真机验证进程回收、前台服务限制、音频焦点和断点恢复后确定适配方案。

### 12.3 AI 辅助

AI 插件在选区菜单注册解释、翻译与提问命令，在 `reader.panel` 中渲染对话界面，通过 `ctx.network` 与 `ctx.credentials` 访问用户配置的服务。

[MUST] 官方 AI 插件发送正文前展示服务域名与发送范围，全书内容访问作为单独选项呈现。

### 12.4 书源

官方 OPDS 插件以 `full` 层级实现，用于验证书源浏览、下载与导入流程。站点专属书源由社区实现，建议在 `sandboxed` 层级可用后迁移到该层级。

[MUST] 书源下载由宿主 `downloads` 服务执行，书库服务完成格式、ZIP 条目、展开大小与 EPUB 结构检查后再导入。插件取得导入结果与书籍引用。

### 12.5 官方插件规划

| 插件      | 主要能力                         | 依赖的宿主服务    |
| --------- | -------------------------------- | ----------------- |
| 阅读统计  | 面板、生命周期事件、存储         | 无                |
| 听书      | 面板、浮层、装饰、导航、后台播放 | `speech`、`audio` |
| AI 辅助   | 选区菜单、面板、网络、凭据       | `clipboard`       |
| 词典      | 选区菜单、浮层、离线词库资源     | `downloads`       |
| OPDS 书源 | 整页路由、网络、下载、导入       | `downloads`       |

阅读统计插件不依赖新宿主服务，作为 SDK 首个验收样例。

## 13. 隔离执行层级（后续）

`sandboxed` 层级面向不受信任来源的数据插件，沿用前版设计的执行模型：

| 项目     | 设计                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 执行环境 | Android 独立执行服务中的嵌入式解释器，候选为 QuickJS                     |
| 通信     | 带请求编号与执行代次的 JSON RPC，宿主从通信端点确定插件身份              |
| 界面     | 可序列化组件树，由宿主映射到 `@umbrae-labs/lunar-plugin-sdk/ui` 组件渲染 |
| 接口     | 与 `full` 层级共用命令、设置、存储、网络、凭据与提供方契约               |
| 限制     | 关闭动态编译、本地文件与原生入口，执行中断与内存上限由宿主实施           |

[MUST] 两个层级的非界面接口保持相同的类型与语义，插件可以在不修改业务逻辑的情况下切换层级。

[MUST] `sandboxed` 层级在真机证明无限循环可中断、身份不可伪造、宿主文件访问受限之后才开放安装。

[SHOULD] `full` 层级的 SDK 新增接口以可序列化参数设计，减少未来进入 `sandboxed` 层级时的契约差异。

## 14. 生命周期与版本兼容

### 14.1 安装状态与执行状态

| 维度 | 状态         | 含义                                     |
| ---- | ------------ | ---------------------------------------- |
| 安装 | `disabled`   | 包验证完成，扩展入口暂停提供             |
| 安装 | `enabled`    | 静态入口可见，按激活事件执行             |
| 安装 | `pending`    | 新版本已验证，等待应用重启后切换         |
| 安装 | `blocked`    | 版本、权限、完整性或连续崩溃要求用户处理 |
| 执行 | `idle`       | 尚未触发激活事件                         |
| 执行 | `activating` | 执行入口并验证本批注册                   |
| 执行 | `active`     | 注册生效，可以处理调用                   |
| 执行 | `failed`     | 本次执行异常，等待用户重试               |

安装器将完整包写入暂存区，完成结构、签名和兼容性检查后才更新安装记录。

### 14.2 停用和卸载

1. 宿主停止向该插件派发事件与命令，标记当前代次结束。
2. 关闭该插件打开的面板、浮层与路由，清除装饰层。
3. 取消该插件所属的网络请求、下载与播放会话。
4. 调用 `deactivate`，在限定时间后继续后续步骤。
5. 撤销全部注册，按用户选择保留或删除插件数据，保存最终安装状态。

[MUST] 清理操作支持重复执行。`deactivate` 失败或超时时，宿主仍须完成清理。

### 14.3 更新与迁移

更新先验证新版本、发布身份、SDK 兼容范围及权限变化。安装确认界面标出新增权限、数据格式变化与降级风险；用户确认即重新授权，取消时继续使用旧版本。

旧版本已在本进程执行过时，新版本进入 `pending` 状态，应用下次启动时切换；否则新版本立即生效。安装记录保留被替换的版本及其文件，直至新版本首次激活成功。连续多次更新而新版本均未激活时，保留的始终是最后一个成功运行过的版本。

清单字段 `dataVersion` 声明插件存储数据的格式版本，默认为 1。宿主为每个插件记录数据所属版本；未记录版本的既有数据视为版本 1，没有数据的插件直接记录当前版本。两者不一致时，宿主在 `activate` 之前调用插件的 `migrate`，传入原版本与目标版本。降级时原版本大于目标版本，由插件决定能否读取。

1. 宿主先为插件存储建立快照，再调用 `migrate`。迁移在限定时间内完成后记录新的数据版本。
2. `migrate` 或随后的 `activate` 失败时，宿主恢复快照与原数据版本。
3. 更新后的首次激活失败时，宿主恢复被替换的版本，并在插件管理页显示失败版本、恢复版本与失败原因。
4. 首次激活成功后，宿主释放快照与被替换版本的文件。
5. 激活过程中应用退出时，下次启动进入安全模式，并对该插件执行第 2、3 步。

[MUST] 数据版本不一致而插件未定义 `migrate` 时，激活失败，数据保持原状。

[MUST] 迁移完成之前，插件没有任何注册，也不接收阅读事件。

[MUST] 同一版本号对应固定包摘要。来源提供相同版本号但内容不同的包时，拒绝覆盖并要求发布新版本。

### 14.4 SDK 版本

SDK 使用语义化版本。破坏现有契约的变更增加主版本，兼容新增能力增加次版本，行为修复增加补丁版本。宿主模块注册表中的模块、公开工具类集合与界面组件属性均纳入该版本规则。

宿主报告 SDK 版本以及命名能力版本。插件清单声明 SDK 范围，宿主在安装时检查；可选能力通过 `host.capabilities` 探测。

试验阶段使用 `0.x`，每个次版本均可能包含破坏变更，试验插件按具体测试版本声明兼容范围。

[MUST] 宿主升级 React 或 React Native 主版本时，同步增加 SDK 主版本，并保留旧主版本插件的不兼容提示。

## 15. 错误契约与资源预算

### 15.1 固定错误

```ts
interface PluginError {
  code: string;
  message: string;
  retryable: boolean;
}
```

| 错误代码                 | 含义                           |
| ------------------------ | ------------------------------ |
| `PERMISSION_DENIED`      | 当前调用缺少所需授权           |
| `CAPABILITY_UNAVAILABLE` | 当前宿主缺少所需能力           |
| `INVALID_ARGUMENT`       | 参数与契约不符                 |
| `INCOMPATIBLE_SDK`       | 插件与宿主版本不兼容           |
| `MODULE_NOT_FOUND`       | 请求的模块不在宿主模块注册表中 |
| `NO_ACTIVE_SESSION`      | 当前没有打开的阅读会话         |
| `ANCHOR_UNAVAILABLE`     | 书籍来源位置无法确定           |
| `QUOTA_EXCEEDED`         | 请求超过资源额度               |
| `NETWORK_DENIED`         | 网络目的地址或请求方式超出授权 |
| `CANCELLED`              | 用户或宿主取消调用             |
| `TIMEOUT`                | 调用超时                       |
| `GENERATION_ENDED`       | 插件执行代次已经结束           |
| `INTEGRITY_FAILED`       | 包完整性或签名验证失败         |

SDK 将错误表现为带固定代码的异常对象。错误消息适合展示，并省略密钥、正文和宿主内部信息。

### 15.2 原型默认预算

这些值作为设备验证起点，最终数值由性能测试确定。宿主通过能力信息公开实际限制。

| 项目                     | 建议初值                             |
| ------------------------ | ------------------------------------ |
| 插件压缩包               | 10 MiB；声明下载资源的插件另行计量   |
| 展开后文件总量           | 30 MiB，最多 500 个条目              |
| 入口文件                 | 2 MiB                                |
| `activate` 总耗时        | 1 秒，超时视为激活失败               |
| `onStartup` 插件同步执行 | 每个 50 ms，超出时在管理页提示       |
| 同步拦截点单次执行       | 16 ms                                |
| 异步拦截点单次执行       | 500 ms                               |
| `deactivate` 等待        | 1 秒                                 |
| `migrate` 总耗时         | 10 秒，超时视为迁移失败并恢复数据    |
| 装饰层                   | 每插件 4 层，每层每页最多 500 个装饰 |
| 装饰更新频率             | 每层每秒最多 10 次                   |
| 同时网络请求             | 每插件最多 4 个                      |
| 普通网络请求             | 30 秒，文本响应最多 2 MiB            |
| 单次选区                 | 最多 32,768 个 UTF-16 代码单元       |
| 插件 JSON KV             | 总量 5 MiB，单值最多 256 KiB         |
| 连续崩溃自动停用         | 10 分钟内 3 次                       |

`full` 层级无法中断持续占用 JavaScript 线程的同步代码。耗时预算用于诊断、提示与跳过后续调用；持续阻塞导致应用无响应时，由第 5.6 节的安全模式恢复。

## 16. 完整插件样例

官方插件 [阅读统计](../../plugins/reading-stats) 是 SDK 0.1 的验收样例，覆盖生命周期事件、工具栏命令、自定义面板、选区菜单拦截、页面装饰、插件设置、插件存储与数据迁移。章节全文能力就绪之前，样例逐页读取可见文本。

```tsx
export default definePlugin({
  // 数据版本 1 记录了逐页定位符，版本 2 只保留字数。
  migrate: (ctx) => migrateBookStats(ctx.storage, ctx.from, ctx.to),

  activate(ctx) {
    const longSentences = ctx.reader.decorations.create('long-sentences');
    const counted = new Set<string>();

    const measure = async () => {
      const segments = await ctx.reader.session.getVisibleText();
      const limit = ctx.settings.get<number>('longSentence');
      longSentences.set(
        segments
          .filter((segment) => countCharacters(segment.text) > limit)
          .map((segment) => ({ range: segment.range, style: 'wavy', color: 'accent' })),
      );
      // 按 segment.key 去重，本次阅读中同一句只计一次。
      const characters = takeUnseen(segments, counted).reduce((sum, item) => sum + countCharacters(item.text), 0);
      const book = ctx.reader.session.current()?.book;
      if (book && characters > 0) {
        await ctx.storage.update(bookStatsKey(book.ref), (stored) => addCharacters(parseBookStats(stored), characters));
      }
    };
    ctx.reader.on('locationChange', () => void measure());
    ctx.reader.on('layoutChange', () => void measure());

    ctx.reader.intercept('selectionMenu', (items) => [
      ...items,
      {
        id: 'count',
        title: ctx.i18n.t('selection.count'),
        icon: 'text',
        onPress: (selection) =>
          ctx.ui.toast(ctx.i18n.t('selection.result', { count: countCharacters(selection.text) })),
      },
    ]);

    ctx.commands.register('open-stats', () => ctx.ui.openPanel('stats'));
    ctx.ui.registerSlot('reader.panel', 'stats', StatsPanel);
  },
});
```

用户打开书籍后，宿主按 `onReaderOpen` 激活插件。每次翻页或重排时，插件读取当前页正文，以波浪线标记超过阈值的句子，并按句子身份累计本次与本书的阅读字数。重排只更新装饰，已计入的句子不再重复计数。用户点击选区菜单中的“字数统计”时，宿主冻结选区并把快照交给插件。组合字符和 emoji 序列可能包含多个码点，面板文案标注了统计单位。

插件停用后，宿主关闭面板、清除装饰层并撤销全部注册。插件存储中的统计数据按用户的卸载选择保留或删除。

## 17. 开发工具与验证

### 17.1 开发流程

| 工具                       | 职责                                            |
| -------------------------- | ----------------------------------------------- |
| `pnpm create lunar-plugin` | 生成插件项目、清单、类型配置与样例              |
| `lunar-plugin build`       | 类型检查、外部模块处理、禁用项检查、单文件构建  |
| `lunar-plugin dev`         | 监听源码并通过局域网向开发构建推送新版本        |
| `lunar-plugin pack`        | 生成完整性清单、签名并输出 `.lunar-plugin`      |
| `lunar-plugin validate`    | 校验清单 Schema、权限、插槽、公开工具类与包大小 |

开发构建提供开发者模式。开发者模式下，应用扫描 `lunar-plugin dev` 输出的配对二维码建立连接，源码保存后宿主撤销旧代次注册并执行新版本入口。

开发连接也把开发中插件的日志按批次回传到 `lunar-plugin dev` 所在终端。通过 USB 调试时，`adb reverse` 映射开发服务端口后可使用回环地址连接。

[MUST] 开发连接只在开发者模式中可用，每次配对使用一次性密钥，正式构建关闭开发服务连接入口。

`@umbrae-labs/lunar-plugin-sdk` 与 `@umbrae-labs/lunar-plugin-cli` 在工作区内直接引用 TypeScript 源码；发布时由 `publishConfig` 切换到编译后的 JavaScript 与类型声明，CLI 要求 Node.js 22.18 及以上版本，工作区内依靠 Node.js 默认的类型剥离直接运行源码。

[MUST] 构建工具的检查用于提前发现问题，宿主运行时仍须执行相同的模块注册表、清单与权限检查。

[SHOULD] SDK 提供宿主模拟实现，使插件逻辑和组件可以在 Node.js 测试环境中进行单元测试。

### 17.2 验收用例

| 场景                     | 必须满足的行为                                    |
| ------------------------ | ------------------------------------------------- |
| 安装篡改包               | 验证失败，原插件保持可用                          |
| ZIP 条目越界或异常展开   | 安装终止，暂存文件清理                            |
| 插件引用未登记模块       | 构建失败；绕过构建时运行期返回 `MODULE_NOT_FOUND` |
| 插件面板渲染抛出异常     | 错误边界显示替代内容，阅读继续响应                |
| 插件激活阶段导致应用崩溃 | 下次启动进入安全模式                              |
| 连续快速翻页             | 翻页帧时间与无插件基线一致，事件合并为最终位置    |
| 装饰集合变化后原生翻页   | 不复用旧外观纹理                                  |
| 拦截钩子超时             | 菜单使用上一环节结果展示                          |
| 活动插件停用             | 面板与浮层关闭，装饰清除，注册撤销                |
| 开发模式热重载           | 旧代次回调失效，注册不重复                        |
| 多个插件使用相同本地标识 | 注册与存储分别归属各自插件                        |
| 更换主题和系统字体大小   | 插件界面组件保持语义颜色与可访问性                |
| 听书进入后台             | 播放会话按 Android 服务规则继续或明确暂停         |

性能验证记录插件激活耗时、插槽首次渲染耗时、阅读帧时间与运行内存。基线选取相同设备上的纯阅读场景，分别比较插件未激活、活动和异常时的表现。

## 18. 实施阶段与完成条件

| 阶段       | 交付内容                                                         | 完成条件                                         |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| A 执行验证 | 加载器、模块注册表、错误边界、安全模式、`reader.toolbar` 原型    | Release 构建真机加载样例插件，插件崩溃不影响阅读 |
| B SDK 原型 | 清单、生命周期事件、命令、面板与浮层插槽、设置与存储、开发热重载 | 第 16 节样例在开发构建中全程可用                 |
| C 阅读扩展 | 正文读取、页面装饰、拦截点、高亮与书签接口                       | 装饰与原生翻页验收通过，阅读统计官方插件发布     |
| D 宿主服务 | 语音、音频、下载、网络代理与凭据                                 | 听书与 AI 官方插件可安装、停用、卸载             |
| E 分发     | 签名、官方目录、权限界面、更新切换与恢复                         | 从官方目录安装与更新官方插件，SDK 1.0 契约确定   |
| F 隔离层级 | `sandboxed` 执行服务与声明式界面                                 | 第 13 节开放条件满足                             |

A 阶段决定执行方案能否成立，应在其他阶段之前完成。B 至 D 阶段持续使用 `0.x` 试验版本。

截至 2026-10-22，A 至 C 阶段的代码已实现，开发构建已在真机上运行阅读统计插件，Release 构建尚未验收。E 阶段中的更新切换、数据迁移与失败恢复已实现，签名与官方目录尚未开始；D、F 阶段尚未开始。

| 模块                               | 内容                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `packages/plugin-sdk`              | 公开类型、清单 Schema、包格式与完整性工具、Hooks 与界面组件声明          |
| `packages/plugin-cli`              | `init`、`build`、`validate`、`pack`、`dev`                               |
| `apps/mobile/src/features/plugins` | 加载器、模块注册表、宿主、阅读桥接、安装器、开发连接、插槽渲染与管理界面 |
| `apps/mobile/src/features/reader`  | 会话事件、会话端口、交互状态、扩展点契约、扩展面板与装饰叠加层           |
| `plugins/reading-stats`            | 官方阅读统计插件                                                         |

SDK 0.1 尚未提供 `getChapterText`、书库元数据接口、语音与音频服务；宿主通过 `host.capabilities` 报告已实现的能力。`library.import` 已支持用户请求的单次 EPUB 字节导入。SDK 0.1.5 起提供凭据服务（`credentials`）、流式网络响应（`network.stream`）与 `Markdown` 组件（`ui.markdown`）。

### 18.1 尚待验证的事项

| 事项                             | 验证方式                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------- |
| 构建产物语法                     | 验证 esbuild `es2020` 输出在宿主 Hermes 上的支持范围，必要时降低目标或增加转换    |
| Release 构建 Hermes 动态执行源码 | RN 0.86 与 Expo SDK 57 Release 构建真机执行 `Function` 包装入口，测量冷启动开销   |
| 动态执行不可用时的替代方案       | 评估由 CLI 生成与宿主 Hermes 版本绑定的字节码及其版本失效处理                     |
| Uniwind 公开工具类               | 验证 `@source inline` 在 Uniwind 中生成运行时可用的样式                           |
| 阅读面板动态扩展                 | `ReaderPanel` 扩展后抽屉、标签栏与 Portal 的行为                                  |
| 多个动态插件标签的导航身份       | Expo SDK 57 真机导航样例                                                          |
| EPUB 来源范围的持久引用          | 跨排版、跨启动和书籍内容变化测试                                                  |
| 装饰参与原生纹理缓存标识         | 原生 `slide` 与卷页在装饰变化前后的画面对比                                       |
| 后台合成与音频播放               | 前后台切换、低内存、断网和音频焦点测试                                            |
| Keystore 凭据存储适配            | `expo-secure-store` 真机读写、卸载清理与备份恢复验证                              |
| 流式网络响应                     | `expo/fetch` 在 Android Release 构建中逐段交付 SSE 响应并遵守 `redirect: 'error'` |
| SDK 包名及许可证                 | 发布前确认名称、依赖许可证及贡献约定                                              |

## 19. 分发与平台规则

Lunar 当前具有 [Android APK 发布机制](../releasing.md)，插件系统首先面向这一分发方式。用户下载 APK 和安装插件包是两项独立操作，插件包只由 Lunar 管理。官方目录为项目维护的索引文件，记录插件版本、包地址、摘要与发布密钥。

如果后续上架 Google Play，需要按届时政策检查动态代码与插件行为。当前政策限制从 Play 外下载 DEX、JAR 和动态库等代码，同时对经虚拟机或解释器间接访问 Android API 的代码设置例外；该例外仍要求遵守其他 Play 政策，`full` 层级同进程执行的插件需要单独评估。[Google Play 规定](https://support.google.com/googleplay/android-developer/answer/16559646?hl=en)

插件管理应提供来源展示、问题反馈和停用入口。版权、服务授权与个人数据处理义务继续适用。官方目录的收录审核与插件执行权限分别管理，收录结果不会扩大插件权限。

iOS 插件执行与分发暂列为后续平台评估。核心 SDK 类型保持平台无关，具体平台开放的能力由宿主明确报告。

## 20. 参考资料

| 资料                                                                                                                             | 用途                       |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| [vnite SDK 类型](https://github.com/ximu3/vnite-plugin-sdk/blob/main/src/types/plugin.ts)                                        | 能力注入与生命周期参考     |
| [PotatoVN 插件服务](https://github.com/GoldenPotato137/PotatoVN/blob/dev/GalgameManager/Services/PluginService/PluginService.cs) | 加载上下文、界面注册与撤销 |
| [Breeze 插件开发文档](https://deretame.github.io/plugin-dev-docs/)                                                               | 隔离脚本与声明式页面协议   |
| [QuickJS](https://bellard.org/quickjs/quickjs.html)                                                                              | 隔离层级解释器候选         |
| [Android 动态代码加载](https://developer.android.com/privacy-and-security/risks/dynamic-code-loading)                            | 代码完整性与加载安全       |
| [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)                                                                           | 项目平台版本依据           |
| [Expo SDK 57 Router UI](https://docs.expo.dev/versions/v57.0.0/sdk/router/ui/)                                                   | 插件路由与自定义导航       |
| [Expo SDK 57 Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)                                                           | 音频实现候选               |
| [Expo SDK 57 Speech](https://docs.expo.dev/versions/v57.0.0/sdk/speech/)                                                         | 系统语音实现候选           |

外部资料核对日期为 2026-10-22。平台文档用于说明当前依据，具体实现以项目测试和发布时的规则为准。
