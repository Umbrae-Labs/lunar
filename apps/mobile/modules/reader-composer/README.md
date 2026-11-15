# reader-composer

Lunar 阅读器的原生翻页合成器，负责页面库存、翻页队列、动画时钟、卷页几何与绘制。

## 接入方式

合成器需要与 react-native-skia 共用同一份 Skia 构建、渲染线程与 GPU 上下文，因此源码直接编译进 `librnskia`，不单独打包为原生库或 Nitro 模块：

- `patches/@shopify__react-native-skia@*.patch` 只提供扩展点：`RNSkPictureExtension.h` 定义绘制接口，`RNSkPictureView` 在图片之后调用扩展绘制，`RNSkManager` 在安装 Skia 绑定时调用 `registerPictureExtension()`。
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

## 约束

- 本目录的头文件可以引用 react-native-skia 的内部头文件；升级 react-native-skia 时需要重新编译检查。
- 页面 `SkPicture` 与 `SkImage` 只能在 `librnskia` 内部解包，JS 接口必须留在本目录，不得迁出到独立的原生库。
- TS 适配位于 `src/reader/skia/anime/native`，业务层不得直接调用 `ReaderComposerApi`。
