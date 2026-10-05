# 阅读业务 Hooks

页面负责组合会话、交互与界面，各目录按业务职责组织。

| 目录         | 职责                                           |
| ------------ | ---------------------------------------------- |
| `session`    | 阅读会话、排版更新、阅读位置保存与阅读时长     |
| `bookmarks`  | 书签数据、当前页书签操作与下拉手势             |
| `selection`  | 选区归属、文字几何、拖动与长按手势             |
| `highlights` | 标注数据、选区标注操作与笔记编辑               |
| `content`    | 脚注、超链接、图片查看与临时图片清理           |
| `controls`   | 面板互斥、视口、安全区域、抽屉导航与音量键订阅 |

`useReaderBookmarks` 与 `useReaderHighlights` 管理数据加载和保存；对应的操作 Hook 管理页面上的交互状态与通知。`useBookmarkPull` 仅管理手势和动画值，`useReaderBookmarkActions` 保留下拉开始时的页面快照并校验提交条件。

`useReaderSelection` 持有选区与引用，通过命令提供选区读取、替换和清除能力。`useReaderSelectionDrag` 管理 UI Runtime 中的拖动状态。`useReaderHighlightActions` 调用选区命令完成标注操作，选区引用由所属 Hook 管理。

`useReaderContentActions` 共同管理图片单击计时器与双击查看，使双击可以取消待执行的链接打开操作，并在图片查看结束时清理临时文件。脚注请求编号用于屏蔽关闭后或新请求开始前的旧结果。

页面保留点击处理顺序和手势组合关系。各操作中的页面身份校验、异步请求校验与资源清理随对应 Hook 管理。运行期状态保存在内存中，用户偏好继续由 `src/stores` 管理。
