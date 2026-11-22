# End-to-end tests

`reading-statistics.py` 在 Android 真机或模拟器中验证统计页、从书籍卡片继续阅读、前台计时、后台停止计时、恢复阅读创建独立会话、界面汇总与 SQLite 记录一致，以及进程重启后的记录保留。

前置条件：运行当前源码的 Lunar development 客户端，Metro 可连接，界面语言为 English，已通过系统文件选择器导入至少一本真实 EPUB。可使用 `tests/fixtures` 中的 EPUB；测试不会清空应用数据或伪造阅读记录。脚本需要 Python 3 标准库与 PATH 中的 adb，使用 `run-as` 读取 development 应用数据库。

从仓库根目录执行：

```powershell
adb -s emulator-5554 reverse tcp:8081 tcp:8081
python apps/mobile/tests/e2e/reading-statistics.py --serial emulator-5554
```

脚本打印测试结果和临时证据目录；该目录包含原生截图、数据库快照和结果 JSON。测试使用 1080×2400 的模拟器视口执行纵向滚动。深浅主题、字体缩放、竖屏滚动、日期色块点按/长按、详情关闭及书籍跳转另通过设备交互检查；跨午夜、夏令时、聚合与删除级联由 `statistics.test.ts` 和 `reading-time.test.ts` 覆盖。

阅读器持续产生可访问性更新时，Android 内置 `uiautomator dump` 可能无法等待空闲。可在独立 Python 环境安装 `uiautomator2`，使用无空闲等待的原生测试服务：

```powershell
python -m pip install uiautomator2
python apps/mobile/tests/e2e/reading-statistics.py --serial emulator-5554 --uiautomator2 --book-title "Alice"
```

`--book-title` 可指定已导入书籍的标题片段，默认选择第一本。前台计时验收等待实际 SQLite 检查点；后台验收会先等待退出时的最终写入完成，再检查至少一个完整计时间隔内记录不再变化。

开发客户端冷启动通过 `--development-url` 重新连接 Metro，默认端口为 8081；自定义开发服务器地址时同步传入该参数。
