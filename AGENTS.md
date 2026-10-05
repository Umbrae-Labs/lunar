# Lunar Agent 地图

> 本文件负责定位。进入具体任务后，仅阅读对应专题文档。

## 项目基线

[MUST] 仓库使用 pnpm workspace，移动应用位于 `apps/mobile`，共享包位于 `packages`，业务插件位于根目录 `plugins`。应用源码与原生配置以 `apps/mobile` 为根目录。

[MUST] Windows 环境仅执行静态检查、测试、Expo 配置解析和 JavaScript 打包；Android 原生编译使用 Linux CNB 环境。

[MUST] 项目采用 Expo SDK 57、React Native、TypeScript、Expo Router、HeroUI Native 与 Uniwind。

[MUST] 静态界面样式使用 Uniwind 的 `className` 声明，禁止调用 `StyleSheet.create`。

[MUST] 应用重新启动后仍需保留的用户设置使用 `react-native-mmkv` 持久化，设置状态由 `apps/mobile/src/stores` 中所属领域的 store 管理，并共用统一的 MMKV 存储适配器。

[MUST] Expo 相关变更以 [Expo SDK 57 版本文档](https://docs.expo.dev/versions/v57.0.0/) 为依据。

[MUST] 产品范围与工程边界以 `docs/` 中的专题约束和当前公开代码契约为依据。

[SHOULD] 专题文档描述的约束优先于未记录的历史约定。

## 文档索引

| 任务范围                               | 必读文档                             |
| -------------------------------------- | ------------------------------------ |
| 目录职责、模块边界、依赖方向           | [代码分层约束](docs/architecture.md) |
| HeroUI Native、自定义原子组件          | [界面组件约束](docs/ui.md)           |
| 业务界面、业务组件、Hooks 与设置持久化 | [业务包约束](docs/features.md)       |
| Rito、Skia、分页与阅读会话             | [阅读内核约束](docs/reader.md)       |
| 浅色主题、深色主题与语义颜色           | [主题约束](docs/theme.md)            |

## 阅读顺序

[MUST] 每项任务先依据本文件确认所属层级，再阅读对应专题文档。

[MUST] 跨层变更同时遵守全部相关专题文档。

[MUST] 专题规则与根文档存在差异时，以范围更具体的专题规则为准。

[MUST] 文档中的强制要求使用 `MUST` 标记，参考性要求使用 `SHOULD` 标记。

[MUST] 约束文档仅描述职责、边界、依赖与取舍，不承担具体实现方案的说明职责。
