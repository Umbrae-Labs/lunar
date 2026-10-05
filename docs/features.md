# 业务包约束

## 业务边界

[MUST] 每个界面业务域存放于独立的 `apps/mobile/src/features/<feature>` 目录。

[MUST] `library` 负责书库、导入与书籍详情界面。

[MUST] `reader` 负责阅读页面、工具栏、目录面板、排版设置与手势组合。

[MUST] `settings` 负责应用设置界面。

[MUST] 每个业务包仅持有本业务相关的组件、Hooks、局部状态、领域类型、仓储、业务服务与专属设备适配器。

[MUST] 仓储接口与持久化实现归属其领域数据的业务包，数据库连接和迁移统一通过 `apps/mobile/src/db` 使用。

[MUST] 单一业务使用的 Expo 能力实现存放于该业务包的 `infrastructure` 目录。

## 设置状态与持久化

[MUST] 应用外观、阅读排版与翻页方式等用户偏好必须在应用重新启动后保留，并使用 `react-native-mmkv` 作为持久化介质。

[MUST] 设置状态依据业务语义归属相应 store；应用级外观归属应用设置 store，阅读排版与翻页方式归属阅读 store。

[MUST] MMKV 实例仅由 `apps/mobile/src/stores` 中的共享存储适配器创建，各领域 store 通过该适配器接入 Zustand 持久化能力。

[MUST] 业务组件与 Hooks 仅调用相应 store 提供的状态和动作，MMKV API 仅在共享存储适配器内使用。

[MUST] 各领域 store 仅保存本领域的用户偏好；阅读会话快照、当前书籍、抽屉开关等运行期状态必须留在内存中。

[MUST] 设置持久化采用 Zustand `persist` 的默认恢复行为。发生会破坏旧数据读取的数据结构变化时，同步增加版本迁移实现与相应测试。

[MUST] 书籍、阅读位置与其他关系型业务数据继续通过所属业务仓储和 `apps/mobile/src/db` 保存，不得写入设置存储。

[SHOULD] 持久化键依据业务域命名，避免不同 store 之间出现名称冲突。

## 层级关系

[MUST] 业务组件通过 `apps/mobile/src/components/ui` 使用全局原子组件。

[MUST] 阅读业务通过 `apps/mobile/src/reader` 的公开契约访问阅读内核。

[MUST] 阅读业务通过 `library` 的公开入口取得书籍记录与受管文件能力契约。

[MUST] 业务包之间通过公开契约共享能力，禁止引用其他业务包的内部文件。

[MUST] 跨业务共享且具有业务语义的能力归属明确的公共领域模块，禁止进入 `apps/mobile/src/components/ui`。

[MUST] Expo Router 页面保持业务编排职责，业务界面与业务 Hooks 归属对应业务包。
