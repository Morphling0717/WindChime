# 桌面 0.6.3 品牌资源验收

日期：2026-09-13。环境：Windows x64，Electron 44.3.0。用户确认使用 `Downloads/windchime_logo` 整套资产，本轮未重新设计 Logo。

## 实际改动

- 完整复制 82 个原始文件到 `assets/branding/windchime_logo`，9,627,889 字节，逐文件 SHA256 与用户目录一致。
- 宽侧栏使用原版导航字标，960 px 及以下使用同源简化图形；两份 SVG 原样复制到构建目录，保留比例和可访问名称。
- 应用 ICO 包含 16/24/32/48/64/128/256 七个尺寸。小尺寸采用交付的白色简化路径与品牌深蓝底板，48 px 及以上采用深底琉璃应用图；托盘复用 32 px 图。
- 安装动画使用完整横版琉璃中英组合，未裁切或重绘字标。保持 640×400、36 帧、每帧 90 ms、无限循环和真实透明圆角。
- 主进程、服务端审核、管理和展示权限逻辑没有修改；共享库继续为 0.6.1，UliUli / Mia 本轮没有代码或部署变动。

## 实际验证

工作目录为 `apps/desktop`：

| 命令／检查 | 结果 |
| --- | --- |
| `npm test` | 构建成功，37/37 自动测试通过 |
| `../../node_modules/.bin/tsc --noEmit -p tsconfig.json` | 类型检查通过 |
| `node_modules/.bin/electron scripts/glass-preview.cjs` | 11 个真实 Electron 界面场景通过，Logo 全部加载成功，宽窄版本切换正确，控制台与页面错误均为 0 |
| ICO 和 PNG 检查 | 七个目录项、图像尺寸及托盘内容正确；实际查看 16/32/48/64 px 导出图和 256 px 应用图 |
| SVG 原件检查 | 只含自包含路径，无脚本、外链、嵌入位图、字体及事件属性；两份运行 SVG 与原件逐字节一致 |

界面报告时间：`2026-09-12T19:53:24.250Z`（北京时间 9 月 13 日）。报告与截图位于 `apps/desktop/out/glass-preview`。实际密钥输入框连接、导航往返保留草稿、结束展示和隐藏命令均通过。未自动批准或上屏，2 封批准队列与未保存稿保留。11 张截图无横向溢出，固定安全按钮仍可见且可点击。本轮没有快捷键冲突警告。

小图预览位于 `apps/desktop/out/branding-preview`；安装画面预览为 `apps/desktop/build/installer-preview.png`。上述是导出图和真实 Electron 渲染验证，未将其表述为所有 Windows 任务栏设置已逐一验证。

## 打包与边界

构建已通过后执行 `node scripts/make.cjs`（等价于 `npm run make` 的打包阶段，避免重复构建）。核验命令为 `node scripts/verify-package.cjs <make 输出的临时目录>`，报告写入 `apps/desktop/out/installers/package-verification.json`；它检查版本、运行资源字节、发行校验和及 Setup 内实际嵌入的动画。

本次打包成功，临时目录为 `C:\Users\ASUS\AppData\Local\Temp\windchime-make-QREt4f`。静态核验退出码 0：ASAR 19 个条目符合白名单，17 个运行文件与当前源码／构建逐字节吻合，四件产物校验和及 RELEASES 引用正确。实际从 Setup 提取的新动画为 1,631,200 字节，与构建动画完全一致。

| 产物 | 大小（字节） | SHA256 |
| --- | ---: | --- |
| WindChime-Setup.exe | 157352448 | `48EE3E97A31CB687AFFFD51A55904E3EAFFEF5A53208E7DA709AA4305A905807` |
| WindChime-win32-x64-0.6.3.zip | 160135631 | `96E4A08F356EB901EEC4954A7767B21714084339BB294AA3C4BA305E7ED2C3C9` |

本轮未执行安装、覆盖安装、卸载或直播软件采集。此前自动审批拒绝了安装清理／重装操作，返回 `blocked by policy`；本轮未改换工具绕过。构建和静态包核验与安装往返分开记录。

0.6.2 的完整展示安全回归、采集和安装边界继续参考 [GLASS-VALIDATION.md](./GLASS-VALIDATION.md)，历史结果不冒充本次新执行项。
