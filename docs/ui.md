# 界面组件约束

[SHOULD] 视觉验证方式遵循用户指定的验收范围与工具边界。

## 组件来源

[MUST] 产品界面的基础交互组件采用 HeroUI Native。

[MUST] HeroUI Native 组件遵循其 React Native API、组合组件结构与语义变体。

[MUST] 项目界面样式采用 Uniwind 与 HeroUI Native 语义变量。

[MUST] 静态界面样式使用 Uniwind 的 `className` 声明，禁止调用 `StyleSheet.create`。

[MUST] 新增第三方界面组件库须经过项目级审查。

## 通知

[MUST] 操作成功、可恢复的错误与短暂状态提示均使用 `heroui-native/toast` 提供的 `useToast` 展示。

[MUST] 成功通知使用 `success` 变体，错误通知使用 `danger` 变体，并提供简明标题与必要的补充文本。

[MUST] 无法继续提供核心内容的错误保留对应页面状态；该状态出现时同时使用 Toast 提示。

[MUST] 禁止在产品代码中使用 `Alert.alert` 展示操作结果或错误信息。

## 全局原子组件

[MUST] 全局自定义原子组件存放于 `apps/mobile/src/components/ui`。

[MUST] `apps/mobile/src/components/ui` 中的组件保持业务命名、业务状态、业务文案与业务数据类型隔离。

[MUST] 同类交互在多个业务包共享时，由 `apps/mobile/src/components/ui` 提供统一组件契约。

[MUST] 通用 Markdown 组件归属 `apps/mobile/src/components/markdown`，由调用方传入内容、输入约束、文案和业务事件处理。

[MUST] 仅由单一业务使用的组件归属对应 `apps/mobile/src/features/<feature>/components`。

## 确认弹窗

[MUST] 需要用户确认后方可执行的操作使用 `apps/mobile/src/components/ui/confirm-modal` 提供的 `ConfirmModal`。

[MUST] 确认弹窗的标题、说明与操作文案由调用业务提供，`ConfirmModal` 不持有业务文案、业务状态或业务数据类型。

[MUST] 确认操作执行期间禁用取消、确认与关闭行为，直至调用业务更新处理状态。

## 可访问性

[MUST] 交互组件具备与用途一致的可访问性角色、名称、状态与触控区域。

[MUST] 文本组件保留系统字体缩放能力。
