# Library feature

该目录负责 EPUB 导入、书架、书籍详情、排序与文件缺失状态。

`domain` 定义书库领域类型，`repositories` 定义书籍仓储及其 SQLite 实现，`services` 负责业务编排和受管书籍文件契约，`infrastructure` 提供 Expo 文件系统与文档选择器适配器。数据库连接和迁移通过 `src/db` 使用。

导入阶段会校验并解压 EPUB 条目到 `books/<bookId>/entries`，同时生成只使用 ZIP Store 方法的 `book.epub`。条目路径、文件 URI、字节数和 SHA-256 保存在 `book_assets` 表中。阅读阶段把无压缩归档交给 Rito，正文、图片、字体仍由 Rito 按当前页面资源请求读取。

## 外部 EPUB 导入

Android 注册 `application/epub+zip` 的 `VIEW`、`SEND` 与 `SEND_MULTIPLE`，供文件管理器打开文件和其他应用分享文件使用。iOS 注册 EPUB 文档类型，接收文档打开请求。通用二进制 MIME 类型暂时保持由应用内文件选择器处理。

`src/app/+native-intent.ts` 将外部文件打开请求交给书库公开入口。Android 分享接收组件处理应用运行期间的分享事件；首次启动的分享请求在初始导航中处理。`external-import-service` 立即缓存来源文件，按顺序调用现有导入服务，同一请求的多个页面订阅共用同一个处理结果。导入完成后清理缓存文件，返回书库并通过 Toast 展示处理结果。

本地 Expo 模块 `modules/expo/epub-receiver` 负责平台文件读取。Android 从内容提供者查询文件名，并通过输入流复制文件；iOS 使用安全作用域访问与文件协调器复制文档。缓存复制阶段限制来源文件为 100 MiB，后续 EPUB 内容校验继续由现有导入服务执行。

原生配置与模块变更随下一次 GitHub Actions 构建生效。安装对应版本后，设备验收覆盖应用关闭和运行期间打开 EPUB、单文件与多文件分享、重复导入、损坏文件、读取权限失效，以及普通 Lunar 链接导航。iOS 另外验证“文件”应用和 iCloud 文档打开。Expo Go 与更新前的安装版本需要使用包含该模块的新应用版本。
