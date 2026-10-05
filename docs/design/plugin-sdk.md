# Lunar 插件 SDK 设计

| 项目         | 内容                                         |
| ------------ | -------------------------------------------- |
| 文档状态     | 设计提案，供开发与评审使用                   |
| 编写日期     | 2026-10-05                                   |
| 代码参考     | Lunar 0.3.0，提交 `850bd6b`                  |
| 首期平台     | Android                                      |
| 主要分发方式 | GitHub Releases 发布 APK，支持本地插件包安装 |
| SDK 目标     | TypeScript 开发接口，JavaScript 执行产物     |

本文描述拟议的插件系统及其实现安排。文中的包名、类型和方法均为设计契约，当前仓库尚未实现这些接口。`@lunar/plugin-sdk` 与 `@lunar/plugin-cli` 为暂定名称，发布前确认包名可用性。

本文属于设计说明。现有工程约束继续以[代码分层约束](../architecture.md)、[业务包约束](../features.md)、[阅读内核约束](../reader.md)、[界面组件约束](../ui.md)和[主题约束](../theme.md)为准。文中的 `MUST` 表示拟议实现的必要条件，`SHOULD` 表示推荐取舍。

## 1. 目标与范围

Lunar 提供公开 SDK，使插件作者能够编写阅读辅助功能。插件负责业务计算及服务适配，宿主负责数据授权、界面呈现、导航、文件管理和设备能力调用。

首个正式 SDK 计划支持授权选区读取、选区菜单扩展、功能页面、底部导航入口、插件设置、受控网络请求、独立数据存储，以及书源、AI、语音服务提供方。官方插件与社区插件使用相同的公开契约和权限检查。

核心阅读、书库访问、插件停用和权限管理始终由宿主提供。第三方插件故障时，用户仍可阅读本地书籍并管理插件。

### 1.1 功能边界

| 能力     | 设计范围                                           |
| -------- | -------------------------------------------------- |
| 阅读内容 | 读取用户授权的选区；后续按具体书籍授权正文访问     |
| 页面     | 注册插件页面，通过受限组件描述构建界面             |
| 操作入口 | 注册选区操作、阅读工具操作、书籍操作和导航入口     |
| 书源     | 查询目录、搜索书籍、返回下载描述，由宿主下载和导入 |
| AI       | 适配服务协议，提供解释、翻译及问答结果             |
| 听书     | 提供语音合成结果，由宿主控制播放和阅读位置同步     |
| 设备能力 | 经命名能力接口使用宿主提供的实现                   |
| 执行代码 | 经过构建的 JavaScript 源码                         |

[MUST] 插件发布物禁止包含 DEX、JAR、动态库、可执行程序、外部引擎字节码或原生组件。JavaScript 引擎及其原生适配随 Lunar 应用发布。

[MUST] 插件访问范围限定在公开 SDK。React Native 原生模块、应用数据库连接、MMKV 实例、Rito 对象、Skia 对象、手势对象和导航器实例均属于宿主内部资源。

### 1.2 首期取舍

采用可编程脚本与声明式界面。插件可以进行异步计算、解析响应和管理业务状态；界面通过可序列化组件树交给宿主渲染。

首期使用 TypeScript 对象描述界面。JSX 语法属于后续开发工具扩展，其编译结果仍为同一组件协议。插件间通信、第三方组件加载、任意后台任务和插件依赖插件暂缓提供。

## 2. 参考项目与采用方式

[vnite-plugin-sdk](https://github.com/ximu3/vnite-plugin-sdk/blob/main/src/types/plugin.ts)提供类型化的宿主 API、事件系统、配置描述和插件生命周期。Lunar 参考能力注入、类型发布和生命周期管理方式，为阅读场景重新定义数据访问范围。

[PotatoVN](https://github.com/GoldenPotato137/PotatoVN/blob/dev/GalgameManager/Services/PluginService/PluginService_ApiHost_Navigation.cs)提供插件页面导航，并具有[侧栏按钮描述](https://github.com/GoldenPotato137/PotatoVN/blob/dev/GalgameManager.WinApp.Base/Models/Plugin/SidebarButtonInfo.cs)。其[加载实现](https://github.com/GoldenPotato137/PotatoVN/blob/dev/GalgameManager/Services/PluginService/PluginService.cs)支持 .NET 程序集。Lunar 参考页面、入口与宿主服务的组织方式，采用 Android 脚本执行环境和受限页面协议。

这些项目用于设计参考。后续采用第三方代码时，分别核对相应文件的许可证和分发义务。

## 3. 当前代码基础与模块职责

### 3.1 当前状态

[app-tabs.tsx](../../apps/mobile/src/components/ui/app-tabs.tsx)固定声明书库和设置入口，按钮类型及图标绑定到这两个页面。[选区操作组件](../../apps/mobile/src/features/reader/components/controls/selection.tsx)包含宿主内置操作，尚未提供插件注册契约。

[阅读内核公开入口](../../apps/mobile/src/reader/index.ts)与[阅读业务公开入口](../../apps/mobile/src/features/reader/index.ts)承担现有阅读契约。[书库公开入口](../../apps/mobile/src/features/library/index.ts)提供书籍记录和受管文件能力。插件适配应使用这些业务域的公开入口，所需的新业务能力应先在所属领域建立公开契约。

设置持久化使用[共享 MMKV 适配器](../../apps/mobile/src/stores/mmkv-state-storage.ts)。插件相关设置继续遵循该机制，业务记录使用所属仓储与 SQLite。

### 3.2 拟议模块

应用位于 `apps/mobile`；SDK 与业务插件使用根目录的工作区成员范围。下表中的插件专属模块为实现安排，尚待创建。

| 模块                                      | 职责                                                 |
| ----------------------------------------- | ---------------------------------------------------- |
| `packages/plugin-protocol`                | 宿主、SDK 与 CLI 共用的清单、消息与界面 Schema       |
| `packages/plugin-sdk`                     | 公开类型、页面描述构造器、插件端通信代理             |
| `packages/plugin-cli`                     | 项目生成、构建、清单检查、打包与签名工具             |
| `apps/mobile/src/features/plugins`        | 安装管理、注册表、授权、执行调度、页面渲染和管理界面 |
| `apps/mobile/src/features/reader`         | 选区快照、书籍会话授权、阅读操作适配                 |
| `apps/mobile/src/features/library`        | 书籍查询、受管下载文件接收、EPUB 校验与导入          |
| `apps/mobile/src/features/audio`          | 拟新增的音频业务域，管理播放队列和后台播放           |
| `apps/mobile/src/features/sources`        | 拟新增的书源业务域，管理浏览和下载体验               |
| `apps/mobile/src/features/assistant`      | 拟新增的 AI 业务域，管理请求、内容授权和结果         |
| `apps/mobile/src/stores/plugin-store.ts`  | 插件启用偏好、导航顺序与声明式设置                   |
| `apps/mobile/modules/expo/plugin-runtime` | Android 执行服务、引擎适配与原生通信                 |
| `apps/mobile/src/app`                     | 装配业务能力、插件页面路由与应用导航                 |

[MUST] SDK 包保持平台无关，依赖范围限定为公开协议与纯 JavaScript 工具。宿主通过适配层实现能力，插件包禁止引用应用内部文件。

[MUST] 应用层创建各业务域的能力适配器并注入插件宿主。阅读业务接收应用层提供的扩展操作，避免阅读业务与插件业务互相导入形成循环依赖。

[MUST] 插件页面渲染器归属插件业务域。全局原子组件仅接收展示数据和交互回调，插件注册表、权限状态和插件身份由业务层管理。

[SHOULD] `app-tabs.tsx` 中的应用导航装配职责迁入应用装配层，共享导航外观可以保留为通用 UI 组件。该调整在页面扩展阶段实施。

### 3.3 调用关系

插件运行环境发送带有请求编号的能力调用。宿主能力代理校验调用身份、协议、权限和资源预算，然后通过业务域公开入口执行操作。宿主向插件返回数据结果或固定错误契约。

界面使用相同的通信基础：插件提交组件树，宿主执行结构校验并渲染；用户操作产生事件，宿主将事件发送给该页面所属插件。回调函数保留在插件运行环境中，跨进程消息仅传递数据及操作标识。

## 4. 插件包与发布身份

### 4.1 文件结构

插件包扩展名建议为 `.lunar-plugin`，内容为 ZIP 容器。

```text
reading-helper.lunar-plugin
  manifest.json
  main.js
  assets/
    icon.png
  locales/
    zh-CN.json
  integrity.json
  signature.json
  LICENSE
```

`main.js` 为单文件 ES Module，默认导出插件定义。SDK 运行时代码和纯 JavaScript 依赖由构建工具合并到该文件。插件安装后使用宿主内置引擎解释源码。

构建目标先采用 ES2020 语法子集，并随 SDK 发布实际运行环境清单。Promise、JSON、Map、Set 等基础对象由引擎提供；取消信号、文本编码和定时器由受控适配实现。DOM、Node.js API、React Runtime 和浏览器全局对象均属于该环境之外的能力。

[MUST] 模块加载器仅接受验证完成的入口文件。运行期间禁止安装 npm 依赖、加载远程模块、加载原生模块或执行宿主命令。

[MUST] 安装器限制压缩包大小、展开大小、条目数量和目录深度，并拒绝绝对文件名、上级目录转义、符号链接、重复条目及大小写规范化后的冲突。

### 4.2 清单示例

```json
{
  "manifestVersion": 1,
  "id": "org.example.reading-helper",
  "name": "阅读助手",
  "version": "0.1.0",
  "sdk": "^1.0.0",
  "platforms": ["android"],
  "entry": "main.js",
  "publisherKeyId": "ed25519:example-key",
  "permissions": [
    {
      "name": "reader.selection.read",
      "reason": "统计本次选中文字的长度"
    }
  ],
  "contributions": {
    "commands": [{ "id": "show-length", "title": "显示文字长度" }],
    "pages": [{ "id": "home", "title": "阅读助手" }],
    "selectionActions": [
      {
        "id": "count",
        "title": "统计文字",
        "command": "show-length",
        "when": "selection.nonEmpty"
      }
    ],
    "tabs": [
      {
        "id": "main",
        "title": "助手",
        "icon": "sparkles",
        "pageId": "home"
      }
    ]
  }
}
```

示例中的名称、权限用途和发布密钥标识仅用于说明。清单字段全部采用封闭 Schema 校验，未知权限与未知扩展类型使安装验证失败。

`contributions` 描述可供宿主展示的扩展目录，插件代码通过注册 API 绑定行为。宿主可以在插件停止执行时显示这些静态入口，用户调用入口后再启动插件。

[MUST] 运行时注册的标识必须存在于清单中。注册 API 可以绑定处理器和页面工厂，标题、目标页面及权限范围以安装时验证的清单为准。

### 4.3 校验与签名

`integrity.json` 保存清单、源码和资源的 SHA-256。签名覆盖规范化的完整哈希清单；哈希清单覆盖包内所有业务文件，并排除自身与签名文件，防止自引用。

发布格式采用 Ed25519 签名。哈希清单包含签名格式版本、文件名、字节数与小写十六进制摘要，文件名先统一为包内相对形式再排序。规范化字节编码必须由 CLI 与宿主共享实现，并提供固定测试向量；签名格式版本确定后保持字节级兼容。

[MUST] 同一插件标识的更新须由受信任的原发布密钥签署。密钥轮换需要旧密钥签署新密钥声明，或由用户在宿主界面确认身份变更。

首次安装展示作者声明、来源、指纹和请求权限。签名证明包的完整性及发布身份连续性，插件行为仍由宿主权限系统约束。官方插件目录使用项目维护的可信索引验证官方发布身份。

开发构建允许本地未签名插件，并在管理界面标记开发来源。正式版本的本地安装要求包签名，首次信任由用户确认。导入文件和添加远程来源均属于安装入口，首期实现本地文件安装。

## 5. 执行环境与通信

### 5.1 执行环境选择

推荐先验证 QuickJS 嵌入式解释器与 Android 独立执行服务的组合。QuickJS 提供内存限制和执行中断接口；Android `isolatedProcess` 服务运行在独立进程中，并通过绑定服务与宿主通信。这些能力为方案基础，具体组合仍需设备原型验证。[QuickJS 文档](https://bellard.org/quickjs/quickjs.html)、[Android Service 文档](https://developer.android.com/guide/topics/manifest/service-element)

[MUST] 第三方脚本与 React Native 主 JavaScript 环境隔离。宿主提供的 JavaScript SDK 对象属于通信代理，权限判断在宿主执行。

[MUST] 插件执行服务设置 `exported=false`，按独立身份运行。执行环境只装载解释器核心和必要通信实现，关闭 `std`、`os`、本地文件、原生模块及任意网络入口。

插件的动态源码编译入口同样受限，运行环境须关闭 `eval`、`Function` 及其构造器变体，并使用封闭模块加载器。仅在 SDK 类型中隐藏这些名称无法形成执行限制，引擎构建与运行时测试应证明限制生效。

宿主通过受控数据传输或只读文件描述符提供验证完成的源码。插件持有的文件描述符限于本次授权资源。普通独立进程通常仍可共享应用权限，因此实现验收必须确认服务使用隔离身份。

每个活动插件实例使用独立执行单元。首期建议最多同时运行两个插件，其他请求进入有界等待队列。插件页面的当前展示树保留在宿主，空闲执行单元可以回收，再次交互时重建业务状态。

执行单元回收仅影响本次行为绑定，启用状态下的清单入口继续保留。活动调用期间禁止作为空闲实例回收；系统强制回收时该调用失败并执行宿主清理。重建实例后根据页面标识和经过检查的恢复参数重新运行页面工厂，旧页面事件与旧授权令牌失效。

引擎版本、Android 绑定实现、进程回收方式和设备内存预算在技术验证阶段确定。首期发布只接收源码，引擎字节码仅允许由宿主自行生成并按引擎版本失效处理。

### 5.2 协议与请求身份

内部消息格式示意：

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface RpcRequest {
  protocolVersion: 1;
  requestId: string;
  method: string;
  params: JsonValue;
}
```

[MUST] 宿主从绑定的通信端点确定插件身份、包版本和本次执行代次。消息中自报的插件标识、授权状态和用户操作标识均不能替代宿主记录。

[MUST] 请求与响应按请求编号和执行代次关联。执行环境重启后，旧响应失效。宿主同时校验 JSON 结构、数值范围、消息长度和对象深度。

SDK 对外提供异步方法。事件处理器中的函数、取消信号及页面控制对象由 SDK 转换为内部标识，通信协议保持可序列化。

涉及导入、创建记录等具有副作用的操作使用宿主生成的操作编号去重。网络服务的业务幂等性由对应协议决定，宿主对结果未知的请求保留查询能力，避免自动重复提交。

### 5.3 取消与故障

宿主取消先使对应调用令牌失效，再取消网络、下载和业务任务。仅使用 JavaScript 定时器或 `Promise.race` 无法终止持续占用 CPU 的脚本；执行中断及执行服务回收须由宿主实施。

进程退出、插件停用、权限撤销和应用关闭均触发资源清理。SDK 的 `deactivate` 提供正常退出机会，最终清理由宿主保证。

## 6. 权限与数据授权

### 6.1 权限目录

安装时展示清单中的权限声明，实际访问按调用场景取得授权。插件管理界面允许用户查看、撤销权限，并清除插件数据。

| 权限                    | 授权对象                 | 默认有效范围                     |
| ----------------------- | ------------------------ | -------------------------------- |
| `reader.selection.read` | 本次选区快照             | 本次操作                         |
| `reader.book.read`      | 用户指定书籍的正文       | 本次服务会话                     |
| `reader.position.read`  | 指定阅读会话的位置       | 本次会话                         |
| `reader.navigate`       | 用户指定书籍的导航操作   | 本次操作或听书会话               |
| `library.metadata.read` | 用户选择的书籍记录       | 本次选择或用户明确保存的书籍集合 |
| `library.import`        | 用户确认的单次 EPUB 导入 | 本次导入任务                     |
| `network.request`       | 具体来源地址与方法集合   | 可撤销的来源授权                 |
| `audio.play`            | 用户启动的播放会话       | 本次播放会话                     |
| `credentials.use`       | 指定服务的凭据用途       | 指定服务与请求范围               |

页面注册、菜单注册和插件专属存储属于基本能力，仍受清单、命名空间和容量限制。底部导航入口另由用户控制显示。

权限属于 Lunar 的应用内授权模型。Android 系统权限由宿主申请，两者分别检查。系统授予 Lunar 的权限并不会自动转交给插件。

### 6.2 选区授权时序

1. 用户选择文字，宿主按静态条件显示可用插件操作；此时插件尚未取得文字。
2. 用户点击某个操作，宿主冻结选区快照并显示插件名称、用途及数据范围。
3. 用户授权后，宿主创建绑定插件身份、本次操作和书籍的临时令牌。
4. 宿主启动插件并调用对应命令，命令通过 SDK 使用令牌取得快照。
5. 操作结束、用户取消、插件停用或授权超时后，令牌失效。

插件读取的是点击时冻结的内容。后续拖动选区和切换书籍不会改变本次快照。选区权限也不会扩展到全书、批注或其他插件。

[MUST] 对象引用仅用于定位资源，每次访问仍需授权。`bookRef`、`selectionRef` 等标识单独出现时不构成访问许可。

### 6.3 授权撤销的边界

宿主可以阻止后续读取并取消在途请求，插件此前取得的明文则可能留存在插件内存、存储或外部服务中。授权界面应准确说明访问范围和外发目的，避免承诺撤销可以回收全部数据。

向远程服务发送选区、笔记或正文时，宿主展示服务域名及用途。原始文本访问与网络权限同时开放后，宿主无法仅依靠类型系统证明所有派生数据的用途；用户应能查看插件拥有的数据权限和网络范围。

[SHOULD] 官方 AI 与语音插件通过宿主服务会话取得所需文本，优先使用短时授权。全书访问作为独立选项呈现。

## 7. SDK 基础契约

以下 TypeScript 片段定义接口形态，完整声明文件由 SDK 实现阶段提供。正式包需要包含 Schema、错误代码、能力版本和每个方法的授权说明。

### 7.1 插件定义与注册

```ts
interface Registration {
  dispose(): Promise<void>;
}

interface PluginDefinition {
  activate(api: PluginAPI): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

interface PluginAPI {
  readonly host: HostInfo;
  readonly commands: CommandsAPI;
  readonly pages: PagesAPI;
  readonly tabs: TabsAPI;
  readonly selectionActions: SelectionActionsAPI;
  readonly reader: ReaderAPI;
  readonly network: NetworkAPI;
  readonly storage: StorageAPI;
  readonly settings: SettingsAPI;
  readonly credentials: CredentialsAPI;
  readonly providers: ProvidersAPI;
}

interface HostInfo {
  sdkVersion: string;
  platform: 'android';
  locale: string;
  capabilities: Readonly<Record<string, number>>;
}

declare function definePlugin(definition: PluginDefinition): PluginDefinition;
```

`activate` 仅完成注册与轻量初始化。SDK 将注册请求暂存为一批，每次注册在宿主接收暂存记录后返回句柄；宿主在激活成功并验证完整后整体采用，激活失败时撤销该批注册。插件依次等待暂存结果，使注册失败对应到具体接口。

宿主自动追踪全部注册句柄。插件可以主动释放句柄，重复释放视为成功。插件停用和执行代次结束时，宿主统一撤销注册。

### 7.2 命令

```ts
type Invocation =
  | {
      kind: 'selection';
      selectionRef: string;
      invocationId: string;
    }
  | {
      kind: 'page';
      pageInstanceId: string;
      payload: JsonValue;
      invocationId: string;
    };

interface CommandContext {
  invocation: Invocation;
  signal: AbortSignal;
}

interface CommandsAPI {
  register(id: string, handler: (context: CommandContext) => Promise<void> | void): Promise<Registration>;
}
```

SDK 的 `AbortSignal` 是插件环境内的兼容对象，宿主通过取消事件更新它。插件页传入的任意业务参数位于 `payload`，操作来源和调用编号由宿主生成。

[MUST] 每个命令隶属当前插件。页面动作可以引用本插件清单中的命令，宿主保留自身命令命名空间。命令之间的内部复用通过插件本地函数完成。

### 7.3 选区与阅读位置

```ts
interface SelectionSnapshot {
  selectionId: string;
  bookRef: string;
  text: string;
  anchorRef?: string;
  capturedAt: number;
}

interface ReaderAPI {
  readSelection(selectionRef: string, options?: { signal?: AbortSignal }): Promise<SelectionSnapshot>;
}

interface SelectionActionsAPI {
  register(id: string): Promise<Registration>;
}
```

`readSelection` 返回展示文本快照。`anchorRef` 由宿主在可以确定正文来源范围时生成，用于后续授权的跳转或标注操作。缺少来源范围时可以读取文字，定位功能应明确呈现为不可用。

[MUST] 文字范围继续采用阅读内核的来源节点与 UTF-16 偏移语义。展示文本和查询文本由宿主分别处理，插件获得的展示文本保留原有段落。

[MUST] `anchorRef` 包含版本和书籍内容身份约束，并与所属插件关联。书籍内容变更后，宿主验证或迁移位置记录；无法确认对应关系时返回 `ANCHOR_UNAVAILABLE`。

`spreadIndex`、`renderId`、分页工件和屏幕坐标属于阅读内核内部身份。SDK 对外使用书籍引用、来源位置引用和进度值，主题与排版变化保持引用语义。

## 8. 页面与扩展位置

### 8.1 组件协议

首期组件提供文本、按钮、行列布局、列表、输入框、开关、选择器、进度和受管图片。所有组件具有封闭属性集合。复杂列表采用分页数据请求，宿主执行虚拟化显示。

用于首期样例的组件子集：

```ts
type UIElement =
  | {
      type: 'column';
      id: string;
      gap?: 'small' | 'medium' | 'large';
      children: UIElement[];
    }
  | {
      type: 'text';
      id: string;
      value: string;
      tone?: 'default' | 'muted';
    }
  | {
      type: 'button';
      id: string;
      label: string;
      command: string;
      payload?: JsonValue;
      variant?: 'primary' | 'secondary';
      disabled?: boolean;
    };

interface PageContext {
  instanceId: string;
  params: JsonValue;
  signal: AbortSignal;
}

interface PagesAPI {
  register(id: string, factory: (context: PageContext) => UIElement | Promise<UIElement>): Promise<Registration>;
  open(id: string, params?: JsonValue): Promise<{ instanceId: string }>;
  replace(instanceId: string, expectedRevision: number, tree: UIElement): Promise<{ revision: number }>;
}

interface TabsAPI {
  register(id: string): Promise<Registration>;
}
```

页面首次渲染的修订号为 `1`。后续替换必须携带期望修订号；冲突返回 `PAGE_REVISION_CONFLICT`。同一插件的多个页面实例分别保存状态、修订号和取消信号。

`open` 仅接受本插件注册的页面。调用发生在有效用户操作或该操作的异步延续内，宿主对频率和调用来源进行验证。后台定时逻辑禁止主动切换用户正在查看的页面。

[MUST] 页面对象只包含可序列化数据。任意 React 组件、HTML、WebView、JavaScript 表达式、原生引用、内联样式和任意 `className` 均排除在该协议之外。

[MUST] 宿主将语义属性映射到 HeroUI Native 和 Uniwind，统一管理颜色、间距、字体缩放、触控区域和无障碍角色。插件操作按钮使用动作名称作为可访问性名称。

图片只能使用包内资源引用或宿主网络服务取得的受管资源引用。Markdown、图片和其他富媒体中的链接、远程加载与导航同样经过宿主授权。

### 8.2 事件和页面生命周期

宿主把控件事件映射到本插件命令，并加入可信的页面实例标识。输入事件传递该控件的值；提交事件传递所属表单的字段。键盘和焦点管理由宿主负责。

页面关闭时取消页面工厂、列表请求和以该页面为所有者的任务。延迟结果经过页面实例和修订检查后才能采用。页面参数限制为小型业务数据，正文、凭据与全书内容通过授权能力取得。

插件的页面状态可暂存在执行环境中。需要在进程重建后恢复的业务状态保存到插件存储；宿主保存轻量导航参数和受管页面身份。

### 8.3 插槽目录

| 扩展位置              | 承载内容     | 显示规则                         |
| --------------------- | ------------ | -------------------------------- |
| `reader.selection`    | 选区命令     | 宿主验证静态条件并控制授权       |
| `reader.toolbar`      | 阅读辅助操作 | 用户决定是否展示                 |
| `library.bookActions` | 单本书籍操作 | 仅提供用户操作涉及的书籍引用     |
| `app.tabs`            | 功能页入口   | 默认收入扩展页，用户可固定到底部 |
| `settings.plugins`    | 插件设置入口 | 由清单 Schema 生成表单           |

首阶段实现 `reader.selection`、`app.tabs` 和插件设置，其他位置沿用同一注册协议补充。

`when` 使用宿主支持的有限条件，例如 `selection.nonEmpty` 和 `book.open`。条件由宿主解释，禁止动态表达式求值。插件在菜单呈现阶段仅获得注册结果，用户选中文字保持在宿主中。

### 8.4 底部导航与路由

页面标识与导航入口标识独立。一个插件可以注册多个页面，首期最多提供一个可固定的底部入口，整个应用建议最多展示五个底部入口。书库和设置保留可访问入口，其他扩展在统一扩展页中列出。

页面由随应用发布的通用路由承载，参数包含插件标识和页面标识。插件安装过程只增加注册记录，路由文件继续由应用构建管理。

当前使用的 `expo-router/ui` 可继续作为导航基础。多个插件页面的独立标签状态需要按 [Expo SDK 57 Router UI](https://docs.expo.dev/versions/v57.0.0/sdk/router/ui/)验证，尤其要检查同一路由模板对应多个标签的身份处理。如果现有实现无法表达所需身份，则在应用层采用自定义导航器，SDK 契约保持一致。

插件停用时，宿主先将活动页面切换到扩展管理页，再移除其导航入口。入口顺序与固定偏好通过插件设置 store 持久化。

## 9. 网络、凭据与存储

### 9.1 网络代理

插件使用 `api.network.request`，参数包含目的地址、方法、受限请求头、请求体、超时和取消信号。宿主统一执行 DNS 解析、连接、重定向及响应大小限制。

```ts
interface NetworkRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  credentialRef?: string;
  signal?: AbortSignal;
}

interface NetworkResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface NetworkAPI {
  request(request: NetworkRequest): Promise<NetworkResponse>;
}
```

[MUST] 来源授权按协议、主机与端口识别，首期仅开放 HTTPS。每次重定向重新检查目的地址；跨来源跳转移除凭据和敏感请求头。首次版本拒绝内网、回环、IPv4 与 IPv6 保留本地地址及云元数据地址，后续自托管书源通过单独权限开放。

网络权限在清单中附带 `origins` 和 `methods` 字段，例如 `origins: ["https://api.example.com"]`、`methods: ["POST"]`。服务地址由用户配置时，宿主在保存配置时重新确认具体来源，授权记录绑定该插件的发布身份和对应配置版本。

[MUST] 地址限制需要覆盖解析结果和实际连接地址，防止域名解析变化绕过检查。平台网络适配必须证明这些约束得到执行。

凭据、Cookie 和缓存按插件及服务来源隔离。插件请求保持独立 Cookie 存储，与应用登录会话分离。错误与日志默认清除请求体、令牌、正文和授权请求头。

普通文本响应适合目录和短请求。AI 流式响应、书籍下载和音频结果通过专门的有界流或宿主管理任务传送，避免大文件进入普通 RPC 消息。

### 9.2 凭据服务

用户在宿主控制的凭据界面输入服务密钥。插件取得 `credentialRef`，宿主按授权的来源、用途和请求方式附加认证信息。

[MUST] SDK 只提供凭据选择、状态查询和授权使用，禁止返回密钥明文。密钥采用 Android Keystore 支持的加密存储，普通 MMKV 设置存储仅保存非敏感引用。

`credentialRef` 与插件发布身份、服务来源及用途绑定。插件专属的密码字段从宿主界面提交到凭据服务，原始值不会作为普通表单事件发送给插件。

需要特殊签名算法的服务由后续宿主认证适配器支持。首期使用限定来源的 Bearer Token 或 API Key 头注入。

### 9.3 持久化分工

| 数据                                   | 归属与介质                                                    |
| -------------------------------------- | ------------------------------------------------------------- |
| 插件启用偏好、固定入口、声明式用户设置 | `apps/mobile/src/stores` 中的插件领域 store，共享 MMKV 适配器 |
| 安装版本、来源、签名、权限授予记录     | 插件业务仓储与 SQLite                                         |
| 插件专属业务记录                       | 插件业务仓储中的命名空间 KV 或结构化表                        |
| 书籍与阅读位置                         | 原所属业务仓储                                                |
| 插件包、下载缓存、音频缓存             | 由所属业务文件服务管理                                        |
| 服务密钥                               | 宿主凭据服务                                                  |
| 页面实例、临时选区令牌、请求状态       | 内存                                                          |

`api.settings` 读取和修改清单声明的设置字段，宿主执行类型校验。`api.storage` 提供插件专属 JSON KV，业务数据与用户偏好保持各自存储语义。

[MUST] 每次存储调用绑定宿主确定的插件身份，禁止插件自行指定其他插件的命名空间。写入操作检查单值大小、总容量和事务条件。

升级时分别处理设置版本迁移和业务数据迁移。迁移函数在受限预算内执行，输入限定为该插件的数据快照，迁移期间仅开放迁移所需的存储能力。SQLite 内部通过事务替换数据，MMKV 设置通过版本化快照替换，整体更新由第 11 节的恢复记录协调。

卸载界面默认清除包、权限、凭据引用和插件专属数据；用户可以选择保留业务记录。导入书库的书籍及用户创建的阅读标注继续归属宿主。

## 10. 官方功能与服务提供方

普通功能通过页面和命令实现。需要与书库、阅读及音频持续协作的功能使用服务提供方契约，使宿主可以统一显示、取消和管理任务。

`api.providers` 规划提供 `sources.register`、`ai.register` 和 `speech.register`。提供方同样需要在清单中声明标识、能力版本和所需权限。以下为领域契约，完整参数类型在相应阶段发布。

### 10.1 EPUB 书源

| 方法              | 输入                         | 输出                             |
| ----------------- | ---------------------------- | -------------------------------- |
| `browse`          | 目录编号、分页游标、取消信号 | 目录项与下一页游标               |
| `search`          | 关键词、分页游标、取消信号   | 书籍摘要与下一页游标             |
| `getBook`         | 书源内部书籍编号             | 元数据、封面资源描述与格式信息   |
| `resolveDownload` | 书籍编号、用户选择的版本     | 下载来源、格式、凭据引用及有效期 |

书源内部编号始终与插件和提供方身份组合使用，独立于本地书库编号。下载描述中的地址和请求头同样经过宿主网络策略校验。

用户选择下载后，宿主建立下载任务并显示来源、文件大小和进度。下载完成后，书库服务检查文件格式、ZIP 条目、展开大小和 EPUB 内容结构，再执行导入事务。插件获得导入结果及授权范围内的书籍引用。

[MUST] 下载任务持有宿主管理的临时文件，插件获得受管引用。文件名、MIME 类型和远程元数据均作为待验证输入。取消和失败时回收临时资源。

首期支持公开或授权的 EPUB 下载服务。OPDS 可作为官方适配器候选；站点专属解析由社区插件实现。书源插件安装说明应列明服务来源和内容使用条件，官方目录只收录能够说明授权依据的来源。

### 10.2 AI 服务

| 方法         | 输入                                     | 输出         |
| ------------ | ---------------------------------------- | ------------ |
| `listModels` | 服务配置、取消信号                       | 可用模型描述 |
| `generate`   | 任务类型、授权文本、模型、参数和取消信号 | 有界结果流   |

任务类型首先提供解释选区、翻译选区和围绕授权内容问答。宿主负责确认发送内容和服务来源，插件负责协议转换。通用 AI 面板由宿主提供，插件也可以注册自己的阅读辅助页面。

结果流事件使用 `text.delta`、`usage`、`completed` 和 `error`。每个事件包含请求标识和单调递增序号，宿主检查重复、乱序、消息大小与总输出额度。流消费暂停时需要背压，超过缓冲容量则取消任务。

[MUST] 插件不得通过模型列表、错误信息或模型输出触发新权限。AI 返回的工具调用需要映射到另外声明的能力，并由宿主检查授权。首期只呈现文本结果。

费用与用量由具体服务决定。用户使用个人服务密钥时，界面应显示请求所使用的服务和账户引用。插件超时或用户取消后，宿主终止本地接收；远端计费是否停止取决于服务协议。

### 10.3 听书与语音服务

| 方法         | 输入                               | 输出                       |
| ------------ | ---------------------------------- | -------------------------- |
| `listVoices` | 服务配置、取消信号                 | 音色与语言列表             |
| `synthesize` | 授权文本片段、音色、语速、片段标识 | 受管音频结果与可选时间标记 |

宿主按阅读来源位置切分文本并建立播放队列。插件完成语音服务适配，音频通过受管下载任务或有界音频通道返回。播放、暂停、音频焦点、通知、锁屏控制、蓝牙事件和后台执行归属音频业务域。

时间标记使用输入片段内的 UTF-16 偏移，宿主把它们映射回书籍来源位置。只有句段时间标记时采用句段高亮；缺少时间标记时显示当前片段，避免用估算值表达精确文字位置。

[MUST] 听书开始时建立明确的书籍授权和播放会话。插件只取得队列所需片段，预取数量和音频缓存受宿主管理。整本书的后台提取需要独立授权。

Android 后台听书由宿主音频服务保持，插件执行按片段调度。通用 JavaScript 定时器与 React 页面挂载状态均不承担后台持续播放职责。

当前依赖清单尚未包含 `expo-audio` 或独立听书业务。音频实现可以评估 [Expo SDK 57 Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)，并在真机验证进程回收、后台合成、前台服务限制、音频焦点和断点恢复后确定适配方案。

系统语音引擎可以作为宿主预装提供方，通过相同选择界面与播放会话使用。网络语音插件和系统语音提供方各自声明能力，业务层根据能力选择可用功能。

## 11. 生命周期与版本兼容

### 11.1 安装状态与执行状态

安装状态和执行状态分别记录，避免把启用偏好等同于持续运行。

| 维度 | 状态         | 含义                           |
| ---- | ------------ | ------------------------------ |
| 安装 | `disabled`   | 包验证完成，扩展入口暂停提供   |
| 安装 | `enabled`    | 允许按用户操作启动             |
| 安装 | `updating`   | 新包正在验证或迁移             |
| 安装 | `blocked`    | 版本、权限或完整性检查要求处理 |
| 执行 | `stopped`    | 当前没有执行实例               |
| 执行 | `activating` | 初始化并验证本批注册           |
| 执行 | `running`    | 可以处理调用                   |
| 执行 | `stopping`   | 取消任务并释放资源             |
| 执行 | `failed`     | 本次执行异常，等待用户重试     |

安装器将完整包写入暂存区，完成结构、签名和兼容性检查后才更新安装记录。启用插件仅登记入口；首次用户操作触发执行环境创建。

应用退出后，用户设置和安装记录继续保存，临时授权与执行实例重新创建。后台下载或音频任务通过对应宿主领域的恢复规则处理。

### 11.2 停用和卸载

1. 宿主停止接收该插件的新调用，并使现有调用令牌失效。
2. 取消插件所属网络请求、页面任务、下载和播放服务会话。
3. 退出活动插件页面，撤销菜单和导航注册。
4. 请求执行环境调用 `deactivate`，在限定时间后终止执行实例。
5. 按用户选择保留或删除插件数据，保存最终安装状态。

[MUST] 清理操作支持重复执行。插件的退出回调失败、超时或进程崩溃时，宿主仍须完成清理。

因插件操作导入的书籍、完成的笔记和其他用户业务记录保持其原领域归属。停用服务提供方会结束相应活动会话，用户可在宿主界面选择其他提供方。

### 11.3 更新与恢复

更新先验证新版本、发布身份、SDK 兼容范围及权限变化。新增权限必须重新授权；用户暂缓授权时继续使用旧版本。

进入切换阶段后暂停旧实例，保留旧包与插件数据快照，在受限迁移环境中转换设置和业务数据。完成注册自检后采用新版本。迁移或激活失败则恢复旧包与数据，并显示失败原因。

文件、SQLite 与 MMKV 各自具有独立提交机制，整体升级采用宿主持久化的恢复记录，记录暂存、迁移、切换和确认阶段。应用启动时首先检查未完成更新，根据记录恢复旧版本或完成新版本切换，再允许插件执行。切换期间冻结该插件的数据修改，确认成功后才释放旧数据快照。

迁移期间禁止网络、书库修改及其他外部副作用。新版本正式启用后产生的外部操作可能无法恢复，因此自动恢复仅覆盖升级事务。后续手动降级须检查数据格式兼容性。

[MUST] 同一版本号对应固定包摘要。来源提供相同版本号但内容不同的包时，拒绝覆盖并要求发布新版本。

### 11.4 API 版本

SDK 使用语义化版本。破坏现有契约的变更增加主版本，兼容新增能力增加次版本，行为修复增加补丁版本。

宿主报告 SDK 版本以及命名能力版本。插件清单声明 SDK 范围和必要能力，宿主在安装时检查必要条件；可选能力通过 `host.capabilities` 探测。

试验阶段使用 `0.x`，清单示例中的 `^1.0.0` 表示目标正式契约。正式版本发布前，试验插件根据具体测试版本声明兼容范围。

插件标识、页面标识、命令标识和提供方标识使用固定命名规则。宿主将本地标识组合为包含发布身份的内部唯一标识，禁止同名插件相互覆盖。

## 12. 错误契约与资源预算

### 12.1 固定错误

```ts
interface PluginError {
  code: string;
  message: string;
  retryable: boolean;
  requestId?: string;
}
```

| 错误代码                 | 含义                           |
| ------------------------ | ------------------------------ |
| `PERMISSION_DENIED`      | 当前调用缺少所需授权           |
| `GRANT_EXPIRED`          | 本次授权令牌失效               |
| `CAPABILITY_UNAVAILABLE` | 当前宿主缺少所需能力           |
| `INVALID_ARGUMENT`       | 参数与契约不符                 |
| `INCOMPATIBLE_SDK`       | 插件与宿主版本不兼容           |
| `PAGE_CLOSED`            | 页面实例结束                   |
| `PAGE_REVISION_CONFLICT` | 页面更新引用旧修订             |
| `ANCHOR_UNAVAILABLE`     | 书籍来源位置无法确定           |
| `QUOTA_EXCEEDED`         | 请求超过资源额度               |
| `NETWORK_DENIED`         | 网络目的地址或请求方式超出授权 |
| `CANCELLED`              | 用户或宿主取消调用             |
| `TIMEOUT`                | 调用超时                       |
| `PLUGIN_TERMINATED`      | 插件执行实例终止               |
| `INTEGRITY_FAILED`       | 包完整性或签名验证失败         |

SDK 将错误表现为带固定代码的异常对象。错误消息适合展示，并省略密钥、正文和宿主内部信息。可恢复错误使用项目统一 Toast；页面无法继续时保留具有重试或退出操作的错误状态。

### 12.2 原型默认预算

这些值作为设备验证起点，最终数值由性能测试确定。宿主可以提供更低预算，并通过能力信息公开实际限制。

| 项目                 | 建议初值                         |
| -------------------- | -------------------------------- |
| 插件压缩包           | 10 MiB                           |
| 展开后文件总量       | 30 MiB，最多 500 个条目          |
| 单插件 JavaScript 堆 | 32 MiB                           |
| 同时活动插件         | 2 个                             |
| 等待启动的调用       | 16 个，超过上限返回额度错误      |
| 连续脚本执行         | 200 ms 后中断                    |
| 激活总耗时           | 3 秒                             |
| 正常停用等待         | 1 秒                             |
| 普通 RPC 消息        | 256 KiB，嵌套深度最多 32         |
| 页面描述             | 最多 500 个节点，嵌套深度最多 12 |
| 页面全量替换         | 每秒最多 5 次                    |
| 普通网络请求         | 30 秒，文本响应最多 2 MiB        |
| 同时网络请求         | 每插件最多 4 个                  |
| 单次选区             | 最多 32,768 个 UTF-16 代码单元   |
| 插件 JSON KV         | 总量 5 MiB，单值最多 256 KiB     |

200 ms 约束用于持续占用解释器的执行片段，异步等待不消耗该段 CPU 预算；异步任务仍有总时限。宿主还应限制一个调用的累计执行量与微任务数量，防止无限微任务规避预算。

JavaScript 堆限额只覆盖解释器内存。原生缓冲、通信队列、图片解码、文件、音频与下载资源另外计量。流式 AI 和下载使用各自任务预算，由对应能力公开。

达到限制时返回明确错误或终止执行。选区超出限制时提示用户缩小选择，禁止静默截断后表示为完整文本。

## 13. 完整插件样例

此样例与第 4 节清单配套，展示授权选区、菜单、页面和底部入口的组合。`@lunar/plugin-sdk` 为拟议接口，示例用于实现验收。

```ts
import { definePlugin } from '@lunar/plugin-sdk';

export default definePlugin({
  async activate(api) {
    await api.pages.register('home', ({ params }) => ({
      type: 'column',
      id: 'root',
      gap: 'medium',
      children: [
        {
          type: 'text',
          id: 'title',
          value: '阅读助手',
        },
        {
          type: 'text',
          id: 'result',
          value: typeof params === 'string' ? params : '选择文字后使用“统计文字”。',
        },
      ],
    }));

    await api.commands.register('show-length', async ({ invocation, signal }) => {
      if (invocation.kind !== 'selection') return;

      const selection = await api.reader.readSelection(invocation.selectionRef, { signal });
      const codePoints = Array.from(selection.text).length;
      await api.pages.open('home', `Unicode 码点数量：${codePoints}`);
    });

    await api.selectionActions.register('count');
    await api.tabs.register('main');
  },
});
```

用户点击“统计文字”后，宿主完成本次授权，启动插件并提交注册，再执行对应命令。SDK 取得选区，计算码点数量，将统计结果作为页面参数展示。组合字符和 emoji 序列可能包含多个码点，样例按码点计数，界面明确标注统计单位。

底部入口默认出现在扩展页中，用户可以将其固定到底部。此样例只有选区权限，网络服务和全书访问保持关闭。插件停用后，宿主撤销样例注册并清除临时授权。

## 14. 开发工具与验证

### 14.1 工具职责

`@lunar/plugin-cli` 规划提供项目生成、类型检查、构建、清单校验、签名与打包。命令名称属于后续工具设计，本阶段只确定输出契约。

构建工具检查 Node.js 内置模块、React Native、原生依赖和外部动态导入，输出单文件 JavaScript。构建检查有助于提前发现问题，宿主运行时仍须执行相同的权限边界。

开发预览可在桌面展示组件协议和模拟服务。真机验证通过 Lunar Develop 构建导入插件包，开发构建与正式构建使用相同权限检查。具体网络调试通道只在开发构建中启用，并要求显式配对。

SDK 契约测试覆盖清单、界面 Schema、协议消息与错误代码。示例插件与 SDK 同版本发布，作为宿主兼容性测试样本。

### 14.2 验收用例

| 场景                     | 必须满足的行为                            |
| ------------------------ | ----------------------------------------- |
| 安装篡改包               | 验证失败，原插件保持可用                  |
| ZIP 条目越界或异常展开   | 安装终止，暂存文件清理                    |
| 首次查看选区菜单         | 插件仅有入口描述，正文保留在宿主          |
| 授权后改变选区           | 插件读取点击时的固定快照                  |
| 伪造其他插件引用         | 宿主拒绝调用                              |
| 权限撤销期间收到响应     | 后续数据交付终止，临时资源清理            |
| 网络重定向和域名解析变化 | 每次目标连接均满足授权范围                |
| 页面快速关闭再打开       | 旧实例响应无法覆盖新页面                  |
| 多个插件使用相同本地标识 | 注册与存储分别归属各自插件                |
| 无限循环或微任务循环     | 执行实例终止，阅读界面继续响应            |
| 大量页面节点或消息       | 宿主在渲染前拒绝超额输入                  |
| 活动插件停用             | 页面退出，入口撤销，任务结束              |
| 升级迁移失败             | 旧包及插件数据恢复                        |
| 系统回收执行进程         | 静态入口可用，后续交互按规则重建实例      |
| 听书进入后台             | 播放会话按 Android 服务规则继续或明确暂停 |
| 更换主题和系统字体大小   | 插件页面保持语义颜色与可访问性            |

性能验证记录执行服务冷启动、菜单触发至首个结果的耗时、运行内存及阅读帧时间。基线选取相同设备上的纯阅读场景，分别比较插件停止、活动和异常终止时的表现。

## 15. 实施阶段与完成条件

| 阶段       | 交付内容                                 | 完成条件                                               |
| ---------- | ---------------------------------------- | ------------------------------------------------------ |
| A 执行验证 | Android 隔离服务、引擎、通信和终止机制   | 真机证明无限循环可中断、身份不可伪造、宿主文件访问受限 |
| B SDK 原型 | 清单、签名安装、权限、命令与生命周期     | 样例插件可安装、授权执行、停用和卸载                   |
| C 界面扩展 | 页面协议、选区菜单、导航入口与设置       | 本文样例全程可用，多实例和主题检查通过                 |
| D 服务契约 | 网络、凭据、书源、AI、音频适配           | 每类提供一个官方示例，取消与资源清理检查通过           |
| E 正式发布 | 兼容性测试、开发文档、升级恢复和发布工具 | SDK 1.0 契约确定，社区插件可以独立构建和安装           |

A 阶段通过后再公开第三方代码安装能力。B 至 D 阶段持续使用试验版本，业务服务与插件运行环境可以分别验证，最终以组合场景验收。

官方插件应优先覆盖本地选区统计、授权 EPUB 目录浏览和个人服务密钥接入。听书在宿主音频基础能力完成后加入，用于检验持续会话和后台执行要求。

### 15.1 尚待验证的事项

| 事项                            | 验证方式                               |
| ------------------------------- | -------------------------------------- |
| QuickJS 与 Android 隔离服务组合 | 原生原型、ABI 与进程终止测试           |
| 多个动态插件标签的导航身份      | Expo SDK 57 真机导航样例               |
| EPUB 来源位置的持久引用         | 跨排版、跨启动和书籍内容变化测试       |
| Keystore 凭据存储适配           | 原生依赖选型与备份恢复验证             |
| 后台合成与音频播放              | 前后台切换、低内存、断网和音频焦点测试 |
| 初始额度是否适合目标设备        | 低内存设备与常用设备测量               |
| SDK 包名及许可证                | 发布前确认名称、依赖许可证及贡献约定   |

这些事项影响实现选型和发布节奏，公开 SDK 的能力边界保持为本文所述的宿主管理模型。

## 16. 分发与平台规则

Lunar 当前具有 [Android APK 发布机制](../releasing.md)，插件系统首先面向这一分发方式。用户下载 APK 和安装插件包是两项独立操作，插件包只由 Lunar 管理。

如果后续上架 Google Play，需要按届时政策检查动态代码与插件行为。当前政策限制从 Play 外下载 DEX、JAR 和动态库等代码，同时对经虚拟机或解释器间接访问 Android API 的代码设置例外；该例外仍要求遵守其他 Play 政策。脚本插件形式本身并非审核保证。[Google Play 规定](https://support.google.com/googleplay/android-developer/answer/16559646?hl=en)

截至 2026-10-05，Android 开发者验证从部分地区及参与商店开始实施，官方计划在 2027 年扩展。开源应用需要按实际分发范围评估身份验证和用户安装体验。[Android 开发者验证](https://developer.android.com/developer-verification)、[开源应用注册说明](https://developer.android.com/developer-verification/guides/open-source-app-registration)

插件管理应提供来源展示、问题反馈和停用入口。版权、服务授权与个人数据处理义务继续适用。官方目录治理与 SDK 执行权限分别管理，目录审核结果不会自动扩大插件权限。

iOS 插件执行与分发暂列为后续平台评估。核心 SDK 类型保持平台无关，具体平台开放的能力由宿主明确报告。

## 17. 参考资料

| 资料                                                                                                                                                | 用途                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| [vnite SDK 类型](https://github.com/ximu3/vnite-plugin-sdk/blob/main/src/types/plugin.ts)                                                           | 能力注入与生命周期参考 |
| [PotatoVN 插件导航](https://github.com/GoldenPotato137/PotatoVN/blob/dev/GalgameManager/Services/PluginService/PluginService_ApiHost_Navigation.cs) | 页面与导航扩展参考     |
| [QuickJS](https://bellard.org/quickjs/quickjs.html)                                                                                                 | 解释器嵌入与执行限制   |
| [Android Service](https://developer.android.com/guide/topics/manifest/service-element)                                                              | 隔离进程与服务配置     |
| [Android 动态代码加载](https://developer.android.com/privacy-and-security/risks/dynamic-code-loading)                                               | 代码完整性与加载安全   |
| [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)                                                                                              | 项目平台版本依据       |
| [Expo SDK 57 Router UI](https://docs.expo.dev/versions/v57.0.0/sdk/router/ui/)                                                                      | 自定义导航组件         |
| [Expo SDK 57 Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)                                                                              | 音频实现候选           |

外部资料核对日期为 2026-10-05。平台文档用于说明当前依据，具体实现以项目测试和发布时的规则为准。
