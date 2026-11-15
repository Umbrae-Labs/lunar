# reader-composer

Lunar 阅读器的原生页面合成器，是阅读页面的唯一呈现者：静止页、页面库存、翻页队列、动画时钟、卷页几何与绘制都在这里。阅读 Canvas 只在它上面绘制文本选区等临时界面。

## 接入方式

合成器需要与 react-native-skia 共用同一份 Skia 构建、渲染线程与 GPU 上下文，因此源码直接编译进 `librnskia`，不单独打包为原生库或 Nitro 模块：

- `patches/@shopify__react-native-skia@*.patch` 只提供扩展点：`RNSkPictureExtension.h` 定义绘制接口，`RNSkPictureView` 先调用扩展绘制，再在其上绘制图片，`RNSkManager` 在安装 Skia 绑定时调用 `registerPictureExtension()`。
- Android 由 Gradle 属性 `rnskiaPictureExtensionDir` 指定本目录，CMake 编译其中全部 `.cpp`，并定义 `RNSKIA_PICTURE_EXTENSION`。
- iOS 由环境变量 `RNSKIA_PICTURE_EXTENSION_DIR` 指定本目录，podspec 将其链接到 pod 根目录下参与编译。
- `plugins/with-reader-composer.js` 在 Expo prebuild 时写入上述两项配置。

本目录没有 `package.json` 与 `expo-module.config.json`，不参与 autolinking。

## 文件

| 文件 | 职责 |
| --- | --- |
| `cpp/PagerCompositor.h` | 合成器本体，只依赖 Skia |
| `cpp/ReaderComposerExtension.h` | 把合成器挂到 Skia 图片视图的扩展点 |
| `cpp/ReaderComposerApi.cpp` | JS 接口 `global.ReaderComposerApi`，并实现 `registerPictureExtension()` |

## 协议

JS 接口为 `global.ReaderComposerApi`，协议版本 14。页面以对象传递：`pageKey`（导航身份）、`textureKey`（绘制外观身份）、`picture`（整个视口，双页为一个跨页）、可选的 `chromePicture`（单页 slide 的固定页眉页脚）与 `pullPicture`（不含书签标记的页面）、`pixelWidth`、`pixelHeight`、`spread`、`paperColor`。

| 方法 | 作用 |
| --- | --- |
| `pagerPresent(id, page, transition, durationMs, launchIntervalMs, force)` | 呈现运行时所在页：同一页只刷新外观；composer 已领先翻到的页不改变画面；带方向时从当前静止页翻过去；其余情况或 `force` 时直接切换 |
| `pagerStockPicture(id, stockId, source, target, direction, durationMs, rapidDurationMs, launchIntervalMs)` | 库存一条从源页到目标页的边，供点按与拖拽由 composer 自行翻页 |
| `pagerSetRestingOffset(id, offset, revealColor)` | 书签下拉时移动静止页，UI 线程调用 |
| `pagerConsumeInput` / `pagerTryConsumeInput` / `pagerBeginGesture` 等 | UI 线程的点按与拖拽输入 |
| `pagerTakeEvents(id)` | 读取 `consumed`、`completed`、`cancelled` 等事件 |

翻页的各个面由 composer 从源页与目标页推导：卷页的双页按书脊拆成半页，slide 使用整页。

## 约束

- 本目录的头文件可以引用 react-native-skia 的内部头文件；升级 react-native-skia 时需要重新编译检查。
- 不得引入 `JsiSkApi.h` 或其聚合的工厂头文件：其中部分头文件定义了非 inline 函数，`RNSkManager.cpp` 已生成一份，再次引入会在链接 `librnskia` 时产生重复符号。只引入实际使用的单个头文件。
- 页面 `SkPicture` 与 `SkImage` 只能在 `librnskia` 内部解包，JS 接口必须留在本目录，不得迁出到独立的原生库。
- TS 适配位于 `src/reader/skia/anime/native`，业务层不得直接调用 `ReaderComposerApi`。
