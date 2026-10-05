# 代码分层约束

## 工作区职责

[MUST] `apps/mobile` 承载 Expo 应用及其专属源码、资源、测试和原生模块。应用内部的层级职责继续遵循本文规定。

[MUST] `packages` 承载具有独立公开入口和依赖声明的共享包。共享包禁止依赖应用内部模块。

[MUST] 根目录 `plugins` 承载独立构建的阅读器插件。插件通过 SDK 的公开契约访问宿主能力；Expo 构建配置插件归属 `apps/mobile/plugins`。

[MUST] 工作区包分别声明运行依赖与开发依赖，仓库根目录管理共享锁文件、依赖策略、补丁和仓库工具。

[SHOULD] 各包使用自身的类型检查、测试与构建命令；根目录命令负责调用各包任务。

## 目录职责

[MUST] `apps/mobile/src/app` 仅承载 Expo Router 路由入口、页面装配与应用级 Provider 装配。

[MUST] `apps/mobile/src/components/ui` 仅承载全局共享且与业务无关的自定义原子组件。

[MUST] `apps/mobile/src/components/providers` 仅承载应用级 Provider。

[MUST] `apps/mobile/src/components/markdown` 承载通用 Markdown 编辑、展示与解析适配，通过公开入口提供组件，保持业务状态、文案与持久化隔离。

[MUST] `apps/mobile/src/features/<feature>` 承载单一业务域的界面、业务组件、Hooks、领域类型、仓储、业务服务与专属设备适配器。

[MUST] `apps/mobile/src/reader` 仅承载 EPUB 阅读内核及其公开契约。

[MUST] `apps/mobile/src/db` 仅承载数据库连接、初始化、结构迁移与事务基础能力。

[MUST] 具有业务语义的数据库查询与行数据映射归属对应业务包的仓储目录。

[MUST] 单一业务使用的文件访问与设备能力实现归属对应业务包的基础设施目录。

[MUST] `apps/mobile/src/stores` 仅承载跨页面共享的应用状态。

[MUST] 层级之间不得形成循环依赖。

## 依赖方向

[MUST] `apps/mobile/src/app` 通过 `apps/mobile/src/features` 组合业务界面。

[MUST] `apps/mobile/src/features` 可以依赖 `apps/mobile/src/components/ui`、`apps/mobile/src/db`、`apps/mobile/src/stores` 与 `apps/mobile/src/reader` 的公开入口。

[MUST] 业务包通过 `apps/mobile/src/components/markdown` 的公开入口使用通用 Markdown 组件；Markdown 组件禁止依赖业务包。

[MUST] 业务包之间仅通过各自公开入口共享领域类型与能力契约。

[MUST] `apps/mobile/src/components/ui` 保持业务无关，且隔离 `apps/mobile/src/features`、`apps/mobile/src/db`、`apps/mobile/src/stores` 与 `apps/mobile/src/reader`。

[MUST] `apps/mobile/src/reader` 保持界面无关，且隔离 `apps/mobile/src/app`、`apps/mobile/src/features` 与 `apps/mobile/src/components/ui`。

[MUST] `apps/mobile/src/db` 保持业务无关，且隔离 `apps/mobile/src/app`、`apps/mobile/src/features`、`apps/mobile/src/components/ui` 与 `apps/mobile/src/reader`。

[MUST] 跨层引用使用各层公开入口，内部文件仅供所属层使用。

## 取舍约束

[SHOULD] 模块职责清晰优先于减少文件数量。

[SHOULD] 层间隔离优先于复用其他层的内部实现。

[SHOULD] 公开契约稳定性优先于暴露更多内部类型。

[SHOULD] 平台相关能力的边界清晰优先于在业务层共享平台细节。
