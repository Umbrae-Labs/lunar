# 发布指南

## 仓库与应用目录

依赖从仓库根目录安装，共用 `pnpm-lock.yaml`。移动应用位于 `apps/mobile`，应用配置、原生模块和 `eas.json` 随应用保存。EAS 命令在应用目录执行，根目录的 CNB 脚本负责切换工作目录并将产物输出到仓库根目录。

根目录 `package.json` 管理仓库工具和命令入口，应用版本以 `apps/mobile/package.json` 为准。

Windows 环境执行类型检查、测试、Lint、Expo 配置解析及 JavaScript 打包。Android 原生编译由 Linux CNB 环境完成。

## 构建与发布

项目使用 CNB 执行 Android arm64 APK 编译，使用 GitHub Actions 触发构建、接收附件并发布 GitHub Release。发布自动化包含 `Release` 与 `Nightly` 两个入口，`CI` 继续负责代码检查。

EAS 使用 `--local`，实际编译在 CNB 的 16 核容器中完成。Expo 账号负责项目访问、签名凭证和 Android 构建编号管理。[EAS 本地构建文档](https://docs.expo.dev/build-reference/local-builds/)

GitHub 的 `ubuntu-24.04` 执行器负责同步、等待、下载和发布，Android 编译由 CNB runner 执行。GitHub 任务摘要提供 CNB 构建日志链接。发布使用自动生成的 `GITHUB_TOKEN`，构建任务授予 `contents: read`，发布任务授予 `contents: write`。[GitHub Actions 权限](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)

共享 action 调用 `scripts/cnb-build.mjs`，沿用原同步配置的 `https://cnb.cool/Umbrae-Labs/lunar` 和 `CNB_SECRET`。脚本将源码提交推送到 `github-build/仓库编号-运行编号-尝试编号-配置` 临时分支，通过 `api_trigger_github_android` 指定提交启动构建。同步使用 `git push -o ci.skip`，随后由 API 单独触发编译。[CNB 自定义事件](https://docs.cnb.cool/zh/build/trigger-rule.html) · [CNB 跳过自动构建](https://docs.cnb.cool/zh/build/skip-pipeline.html)

CNB 编译、签名验证和 APK 元数据验证成功后，将附件保存到对应提交，文件名称包含 GitHub 运行身份。GitHub 仅在 CNB 返回成功状态后下载这些附件，核对源码提交、构建配置与 SHA-256，再保存为该次 Actions 运行的附件。GitHub 发布令牌仅用于 GitHub 发布任务。[CNB API 定义](https://api.cnb.cool/swagger.json)

CNB 复用现有 Node.js 22 镜像与 Android、Gradle 和 pnpm 缓存，由 `scripts/build-android.sh` 准备 Java 17、初始化 Android SDK、安装依赖、执行检查，再通过 EAS CLI 21.8.0 本地编译并校验 APK 签名。SDK 包清单为 `platform-tools`、`platforms;android-36`、`build-tools;36.0.0`、`ndk;27.1.12297006` 和 `cmake;3.30.5`。

`@umbrae-labs/rito-rn@0.2.1` 在 npm 包中提供 Android ARM64 静态库与 iOS XCFramework。Lunar 使用包内预编译 Rust 库，构建环境省去 Rust、cargo-ndk 的安装及 Cargo 缓存挂载。NDK 与 CMake 继续用于 Nitro 桥接、Skia 等原生模块的编译。Rito 内核源码编译由独立的 `rito-rn` 仓库维护。

Android SDK 与后续 APK 校验共用 `/opt/android-sdk`。`scripts/cnb-build-android.sh` 在编译前核对检出的提交，在编译后执行现有 release 或 nightly 的产物准备脚本。

`.cnb.yml` 保留 CNB 分支开发构建，并增加供 GitHub 调用的 API 事件。每个构建任务独立申请 CNB runner，Nightly 与 Develop 使用同一源码提交。

## 应用版本

| 用途     | EAS 配置      | APK 包名                     | 使用方式             |
| -------- | ------------- | ---------------------------- | -------------------- |
| 正式发布 | `release`     | `com.lunarain_079.lunar`     | 安装后独立运行       |
| 每日测试 | `nightly`     | `com.lunarain_079.lunar`     | 覆盖正式版后独立运行 |
| Develop  | `development` | `com.lunarain_079.lunar.dev` | 连接 Expo 开发服务器 |

Nightly 与正式版共用包名，覆盖安装后沿用书库、阅读进度和设置。Develop 使用独立包名和存储，可以与正式版或 Nightly 同时安装。`nightly` 继承 `release` 的 APK 编译和签名配置，使用 `APP_VARIANT=nightly` 与 Expo `preview` 环境。`development` 保留 Expo 开发客户端。`production` 继续用于 AAB 构建。[Expo 应用变体](https://docs.expo.dev/build-reference/variants/) · [Expo SDK 57 开发客户端](https://docs.expo.dev/versions/v57.0.0/sdk/dev-client/)

正式版与 Nightly 的应用显示名称统一为 `lunar`，Develop 保留 `lunar Dev`。链接协议分别为 `lunar`、`lunar-nightly` 与 `lunar-dev`，开发客户端自动协议仅由 Develop 注册。

应用版本号继续使用 `X.Y.Z`。关于页面中的正式版显示基础版本号，Nightly 显示为 `X.Y.Z Nightly · abc1234`，其中 `abc1234` 为源码提交编号的前七位。构建脚本将当前 Git 提交编号保存到 Expo 配置的 `extra.buildCommit`，应用变体保存到 `extra.buildVariant`；本地预览缺少提交信息时显示 `X.Y.Z Nightly`。Nightly 发布标题、预发布标记和 APK 文件名继续标识发布用途。

## 首次配置

在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 配置 `CNB_SECRET`，其访问范围为 `Umbrae-Labs/lunar`，权限包含 `repo-code:rw` 和 `repo-cnb-trigger:rw`。前者用于同步源码及读取提交附件，后者用于触发、查询和停止构建。原同步令牌只有代码权限时，需要增加构建权限。

CNB 继续从 `https://cnb.cool/Umbrae-Labs/secrets/-/blob/main/expo.yml` 导入 `EXPO_TOKEN`，该密钥文件应允许 Lunar 构建读取。对应 Expo 账号应具有项目 `523fd44d-54f4-4bde-9561-e75955b19f4d` 的访问权限。Release 上传使用 GitHub 任务生成的 `GITHUB_TOKEN`。

`expo.yml` 的 `allow_slugs` 应包含 `Umbrae-Labs/lunar`，`allow_events` 应包含 `api_trigger_github_android`，并保留原有开发构建所用的 `push`。如果该文件配置了 `allow_branches`，在原有列表中增加 `github-build/**`；现有 `**` 规则也能匹配这些临时分支。`EXPO_TOKEN` 保持原值。[CNB 密钥文件引用权限](https://docs.cnb.cool/zh/build/file-reference.html)

原有 `github-release.yml` 保存的是 `GITHUB_RELEASE_TOKEN`。当前 CNB 配置仅导入 `expo.yml`，GitHub 发布任务使用自动生成的 `GITHUB_TOKEN`，因此 `github-release.yml` 可以保持原样。

首次运行前确认 `release` 和 `nightly` 两个配置对共用包名使用相同的 EAS 托管 Android 签名凭证。交互式凭证初始化在本地完成，Actions 构建使用非交互模式。

```sh
cd apps/mobile
pnpm dlx eas-cli@21.8.0 credentials --platform android
```

分别选择对应配置并检查凭证。此前分发的正式 APK 应继续使用同一 keystore，以支持覆盖安装。签名文件、密码及 `credentials.json` 保存在私密存储中。

发布配置首先提交到默认分支，再从 Actions 页面启动发布。Release 与 Nightly 手动任务读取所选分支，执行时优先选择默认分支。GitHub 对目标提交中相对默认分支的 Actions 配置修改，可能要求额外的 Workflows 写入权限，任务自带令牌无法授予该权限。[GitHub Release API 权限](https://docs.github.com/en/rest/releases/releases#create-a-release)

## Changelog 组织

每个完整标签对应一个目录，目录内提供中文和英文文件：

```text
changelog/
  README.md
  v0.1.1/
    zh-CN.md
    en-US.md
  v0.2.0-rc.1/
    zh-CN.md
    en-US.md
```

单个 `CHANGELOG.md` 适合较短的单语言记录。项目采用版本目录，便于分别维护翻译、精确读取标签对应记录，后续也能增加其他语言。

两份文件随发布代码提交。脚本读取本次发布提交中的内容，按中文、英文顺序生成 Release 正文。中文放在默认折叠的 `<details>` 区域内，英文保持展开。缺少文件、内容为空或包含占位文字时，检查终止。候选版本也使用完整标签目录，正式版目录可根据最终功能重新整理。

`changelog/v0.1.1/` 提供首版发布说明，可参考其格式准备各版本记录，并在启动发布前核对内容。

## Release

`.github/workflows/release.yml` 仅通过 `workflow_dispatch` 手动触发。在 GitHub 的 `Actions → Release → Run workflow` 中选择发布分支，在 `version` 字段填写 `0.3.0` 或 `0.3.0-rc.1`，省略 `v` 前缀。构建与发布固定使用触发时的提交，自动生成的标签指向同一提交。

`apps/mobile/package.json` 的 `version` 与 `apps/mobile/app.json` 的 `expo.version` 使用相同的 `X.Y.Z`。正式标签为 `vX.Y.Z`，预发布标签支持 `vX.Y.Z-alpha.N`、`vX.Y.Z-beta.N` 和 `vX.Y.Z-rc.N`，N 为正整数。候选版本的两个版本字段仍使用 `X.Y.Z`。

以 `0.3.0` 为例，准备两个版本字段与 `changelog/v0.3.0/` 中的双语记录，提交并推送到发布分支。启动 Actions 前可在本地执行：

```sh
pnpm run check
node scripts/release.mjs validate v0.3.0
```

任务先核对代码版本、changelog 与 GitHub 发布状态，再执行类型检查、测试、Lint 和 Expo 依赖检查。编译后校验 APK 包名、版本、arm64 架构、调试标记及签名。发布任务从该次运行下载附件，检查提交与摘要，再上传到 Release 草稿。所有附件上传成功并再次检查发布状态后，公开 Release，同时由 GitHub 创建对应标签。首次发布无需提前创建或推送标签。

上传失败时保留草稿，同一提交可重试；公开版本或其他提交管理的草稿会阻止再次发布。如果同名标签存在，脚本要求其指向本次构建提交，并保留该标签。

公开附件为 `lunar-v0.3.0-android-arm64-v8a.apk`、`SHA256SUMS.txt` 与 `release.json`。正式版本按照版本号规则参与 Latest 选择；候选版本标记为 Prerelease。

发布正文末尾提供 `Full changelog` 比较链接，展示上一正式版本至当前标签的所有提交。脚本分页读取 GitHub Release，以版本号选择低于当前版本的最高正式版本，跳过草稿、Nightly 和候选版本。首次正式发布时省略比较链接；候选版本也与上一正式版本比较。

Android `versionCode` 由 EAS 远程管理，release 与 nightly 构建自动递增，重试可能消耗新的编号。实际编号记录在发布元数据中。[EAS 版本管理](https://docs.expo.dev/build-reference/app-versions/)

## Nightly 与 Develop

`.github/workflows/nightly.yml` 仅通过 `workflow_dispatch` 手动触发。在 GitHub 的 `Actions → Nightly → Run workflow` 中选择分支并启动构建。

两个构建任务使用同一提交，分别编译 Nightly 与 Develop。双方成功后，发布 `nightly-YYYYMMDD-运行编号` 标签对应的 GitHub Prerelease，提供 `lunar-nightly.apk`、`lunar-develop.apk`、`SHA256SUMS.txt` 和 `nightly.json`。Nightly 构建保留版本历史，正式版的 Latest 标记继续由 release 管理。每次手动触发执行完整构建。

Nightly 内置 JavaScript，可用于日常测试。Develop 需要检出对应提交后启动 Metro。在 PowerShell 中执行：

```powershell
$env:APP_VARIANT = 'development'
pnpm start --dev-client
```

Nightly 发布说明的中文默认折叠，英文保持展开，均包含预发布注意事项及两个 APK 的用途。Nightly 用于提前体验最新功能，安装前请备份重要书籍和数据。覆盖安装要求签名一致且 `versionCode` 满足更新条件；恢复使用正式版时，需要构建编号更高且数据格式兼容的正式版本。此前使用 `.nightly` 独立包名的安装保留原有独立数据，切换前需另行备份和迁移。

在具备 Android 编译条件的 Linux 环境切换应用变体时，先重新生成原生工程：

```sh
export APP_VARIANT=development
pnpm --filter @lunar/mobile exec expo prebuild --clean --platform android
pnpm android
```

`prebuild --clean` 会替换生成的 Android 目录，原生定制应保存在配置插件中。

## R8 编译内存

`Java heap space` 表示 Java 堆耗尽。针对 CNB 的 16 核、32 GiB 容器，`scripts/build-android.sh` 默认设置 Gradle 堆上限为 8192 MiB、Metaspace 上限为 1024 MiB，Kotlin 独立堆上限为 2048 MiB、Metaspace 上限为 512 MiB。Gradle worker 上限为 4，项目并行执行开启，兼顾编译速度和内存余量。worker 数量仅约束 Gradle 任务调度，R8 内部仍可使用多线程。R8 压缩和资源裁剪继续启用。

构建脚本将参数传递给 `apps/mobile/plugins/with-android-build-memory.js`，由 Expo prebuild 保存到生成的 `apps/mobile/android/gradle.properties`。本地开发在省略这些环境变量时沿用 Expo 默认设置。CNB 的开发、Nightly 和正式构建共用此脚本。[Expo 配置插件](https://docs.expo.dev/config-plugins/plugins/) · [Android 构建内存配置](https://developer.android.com/build/optimize-your-build#increase-the-jvm-heap-size)

构建日志输出 cgroup 内存限制和 `free -m`。容器内存预算应以 cgroup 限制为准，`free` 可能展示宿主机内存。8 GiB 是 Gradle JVM 的堆上限，整个构建还需要 Java 堆之外的内存、Kotlin、Metro 和原生编译器内存；实际峰值仍需通过构建观测。确认构建成功且容器内存有充足余量后，可通过 `LUNAR_ANDROID_GRADLE_WORKERS=6` 比较构建耗时。

如果 8 GiB 堆仍然耗尽，确认容器余量后，可在 CNB 环境中设置 `LUNAR_ANDROID_GRADLE_HEAP_MB=12288`。`LUNAR_ANDROID_KOTLIN_HEAP_MB` 单独控制 Kotlin 堆上限。进程被系统终止或出现退出码 137 时，应检查容器总内存消耗，优先通过 `LUNAR_ANDROID_GRADLE_WORKERS=2` 降低并发或增加容器内存。

如果需要分析 R8 的具体对象占用，可临时在插件的 `org.gradle.jvmargs` 中增加 `-XX:+HeapDumpOnOutOfMemoryError`，并保留 EAS 临时构建目录。堆转储可能占用数 GiB 磁盘，常规构建省略该选项。Gradle 弃用提示应另行处理，本次堆耗尽应优先调整 JVM 内存。

## 失败处理与验证

CNB 构建失败或被取消时，GitHub 构建任务失败，发布任务跳过执行。等待上限为 160 分钟，超时后尝试停止 CNB 构建。GitHub 取消信号也会触发停止处理。任务结束后删除临时 CNB 分支；强制终止导致清理未完成时，可根据任务摘要中的构建链接和日志中的分支名称手动处理。

上传中断时，Release 保持草稿。在附件保留期内重新执行失败的发布任务，会使用同一次运行的构建附件。重新执行全部任务会重新编译并替换该运行的 Actions 附件，CNB 附件使用新的尝试编号。CNB 和 Actions 附件均保留七天，公开 Release 附件继续保存。

同一提交、同一标签的自动草稿支持恢复。公开 Release 和人工草稿受到保护，后续修改使用新标签发布。Nightly 重试沿用该次运行的标签，标签提交发生变化时发布检查终止。

完整远程构建需要上述 CNB 与 Expo 凭证。首次远程构建后还需验证 Nightly 与正式版的覆盖安装、数据保留，以及 Develop 的共存和启动。
