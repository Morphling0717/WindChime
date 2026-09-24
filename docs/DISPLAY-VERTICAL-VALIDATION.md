# 竖向排版与固定图片区验收

2026-09-20，北京时间。Windows x64，Electron 44.3.0。所有信件和图片为合成数据，桌面测试使用隔离配置。此次未连接生产数据库、发布安装包或更新线上网站。

## 实现

- 增加弹幕侧栏（360 × 800）、竖向信笺（480 × 860）、居中短笺（600 × 900）。与既有三个排版组成六种选择，每种均适用纯净、UliUli、Mia 三个独立主题。
- 图片独立于文字滚动区，始终显示在文字下方；保持原比例并完整缩放，小原图也可放大。支持一至三张、横排/纵排/网格。
- 图片默认占内容区域高度 45%，可调 20%–70%；矮窗口为文字保留空间。长图片说明编号后放入文字区随正文滚动，不截断说明。
- 只有当前批准快照的文字循环；普通轮询不回顶，换稿/外观变化重置，隐藏或失效立即卸载卡片。
- 选择排版保留自定义尺寸；「使用推荐尺寸」只修改宽高。旧服务端缺少新的图片区设置时可私下预览，但应用按钮禁用并提示升级。

## 实际验证

| 命令（仓库根目录） | 结果 |
| --- | --- |
| `npm test` | 179/179 通过；含主题/排版独立、旧数据兼容、六种枚举和占比校验、保存/重启持久化、旧站点禁用保存、内容转义及图片顺序 |
| `npm --prefix apps/desktop run build` | 通过 |
| `node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --jsx react-jsx --lib es2023,dom apps/desktop/src/control.tsx` | 通过 |
| `node scripts/build-display-designs.mjs` | 生成自包含离线样板 |
| `node apps/desktop/node_modules/electron/cli.js scripts/display-designs-smoke.cjs` | 108 组合及 7 组行为检查通过，0 渲染错误；含三种多图排列 × 20%/45%/70% 图区、滚动全程图片坐标固定、原比例、长说明可达、同信回顶、换稿重置和隐藏取消 |
| `node apps/desktop/node_modules/electron/cli.js apps/desktop/scripts/display-viewport-smoke.cjs` | 5 组通过，0 渲染错误；实际展示入口在 420/300px 窗口内文字循环、三张混合比例图片不动，小图放大，隐藏后保持空白 |
| `node apps/desktop/scripts/run-management-smoke.cjs` | 14 组通过，另一个独立进程的 4 组恢复检查通过；324 次合成站点 HTTP 请求，0 渲染错误。宽窄桌面预览、保存、冲突保护、话题切换及图片固定行为均通过 |

极端参数（180px 高、96px 字、32px 内边距、请求 70% 图区）测试保证文字区不会归零、图片不会越界；并不表示该尺寸能完整容纳一整行大字。正常使用可采用各排版推荐尺寸。

测试期间修复了两个显示边界：小尺寸原图原本只会缩小、不会放大，现按图片格可用宽高等比放大；原本按字号增长的间距可能挤没文字区，现约束间距并为文字保留空间。首轮图库检查通过 108 组合后，因旧测试要求样本文字大于 500 字而停止；新样本为约 400 多字，已修正样本长度门槛并保留实际溢出、完整内容和滚动边界断言。

证据：[共享库测试](evidence/vertical-display/shared-tests.txt)、[独立输出报告](evidence/vertical-display/output-viewport.json)、[420px 输出](evidence/vertical-display/output-420.png)、[300px 输出](evidence/vertical-display/output-300.png)、[桌面联调报告](evidence/vertical-display/desktop-management.json)、[第二进程恢复](evidence/vertical-display/desktop-restart.json)。

图形证据：[108 组合报告](evidence/vertical-display/gallery.json)、[三种竖向排版](evidence/vertical-display/three-vertical-layouts.png)、[十八组合](evidence/vertical-display/eighteen-combinations.png)、[弹幕侧栏](evidence/vertical-display/sidebar-full.png)、[竖向信笺](evidence/vertical-display/portrait-full.png)、[居中短笺](evidence/vertical-display/focus-full.png)、[文字到底时三张固定图片](evidence/vertical-display/portrait-bottom.png)。截图中的主题标题属于私人设计样板，卡片观众区域不包含 UliUli/Mia 名称。

## 验证边界

这些结果验证共享组件、实际 Electron 入口和隔离桌面 UI，没有把窗口内显示等同于 OBS/直播姬采集验收。此次没有重新验证真实系统热键、安装/卸载；此前记录见 [磁贴验收](DESKTOP-TILES-VALIDATION.md)。服务端保存新枚举和 `imageHeightPercent` 需要网站同步升级，发布和回退要求见 [展示设计说明](DISPLAY-DESIGNS.md#配置兼容与发行注意)。
