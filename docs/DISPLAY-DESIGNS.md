# 展示主题与排版设计

2026-09-20 更新。设计已进入共享组件及桌面 0.8.0，另提供自包含设计样板。发行、部署与验证范围见 [0.8.0 发行记录](RELEASE-080.md)，以下历史测试记录保留各自的执行范围。

## 设计结构

| 独立选择 | 首批选项 | 负责内容 |
| --- | --- | --- |
| 内容排版 | 经典信笺、文字双栏、横向条幅、弹幕侧栏、竖向信笺、居中短笺 | 称呼与正文的阅读方式；所有图片固定在下方，只有文字滚动 |
| 视觉主题 | 纯净、UliUli 夜航、Mia 星祷 | 背景、颜色、边框、圆角、装饰及字体预设 |

每个主题适用全部六种排版。`applyLiveTheme()` 不修改布局、图片排列、图片占比、字号、内边距、行高、字距、宽高或动画。选择排版也保留当前尺寸；需要调整画面比例时，再点击「使用推荐尺寸」。

| 排版 | 推荐尺寸 | 适用位置 |
| --- | --- | --- |
| 经典信笺 | 1000 × 640 | 居中的日常读信区域 |
| 文字双栏 | 1200 × 640 | 宽幅正文，两列阅读；窄屏退回单列 |
| 横向条幅 | 1280 × 360 | 画面下方，称呼与正文并排 |
| 弹幕侧栏 | 360 × 800 | 直播画面两侧，紧凑的单列文字 |
| 竖向信笺 | 480 × 860 | 居中称呼、正文首行缩进的修长信纸 |
| 居中短笺 | 600 × 900 | 居中正文、下方署名，适合短句；长文仍可滚动 |

展示卡片默认固定 640px 高度。正文、昵称、外链文字及图片说明超出上方文字区域时，顶部停留 2 秒，以每秒 24px 向下滚动；到底停留 2.5 秒，再回到顶部循环。图片、边框和背景不随文字移动。设置可调整画面高度、速度、顶部/底部停留时间，或关闭自动滚动。能放下的短信不滚动；该循环只发生在当前已批准信件内部，不自动换到下一封。

图片在文字下方的固定区域完整、等比例显示，小原图也会放大到可用空间。默认占内容区域高度的 45%，可调 20%–70%；矮窗口会自动为文字保留空间，因此实际占比可能低于设定值。多图可横排、纵排或网格，所有图片同时显示，不自动轮播。图片说明移入上方文字区并与图片编号对应，长说明不被裁掉。没有图片时文字使用完整区域。观众端不显示 UliUli、Mia 或固定品牌行，私人界面保留主题名称供选择。

- **纯净**：默认透明、白色文字、无装饰、无边框，保留现有简洁展示用途。用户仍可自行调整字体、颜色和背景。
- **UliUli 夜航**：参考 UliUli 的 `#050508` 深黑、`#2de2e6` 霓虹青与深蓝氛围，采用细描边、短折角、信号环和清晰黑体；装饰避开正文重点区域。
- **Mia 星祷**：参考 Mia 的 `#fbf6ec` 奶白、`#c4a96e` 香槟金及 `#2b2620` 墨色，采用双细线、淡拱窗、小星芒和宋体回退。

品牌依据来自两站现有 `app/globals.css`、`components/mail/mail-theme.ts` 和公开 UI。装饰使用内置 CSS/SVG，没有复制角色图片或远程背景。字体使用本机字体栈，不请求 Google Fonts，不宣称已捆绑 Noto 字体；在 Windows 上优先使用可用的微软雅黑/宋体等回退。

## 查看与使用

安装仓库根目录及 `apps/desktop` 依赖后：

```powershell
node scripts/build-display-designs.mjs
```

输出 `.work/display-designs/WindChime-Display-Designs.html`，可在浏览器离线打开。默认展示弹幕侧栏，支持自由搭配、18 组合总览、推荐比例、1–3 张图片、图片占比、长信及隐藏示例。文件自包含且 CSP 禁止网络请求；示例信件和插图均为合成内容。

桌面源码的“设置与外观”已接入同一渲染器，可先预览再应用。预览按画面尺寸等比例缩放，并以与观众端相同的固定视窗和循环规则显示示例；支持长信示例。未保存调整保留、跨控制端外观冲突需确认。旧站点缺少新版外观字段时，预览仍可使用，“应用外观”禁用并明确说明需要升级网站。独立磁贴和下一封热键见 [使用说明](FLOATING-TILES.md)。

开发者可继续通过 `WindChimeLiveDisplay` 的 `render` 参数完全替换组件；默认 `WindChimeLiveCard` 及主题/排版工具从 `/broadcast` 导出。渲染器仍只接收当前已批准快照及已授权图片 URL。

## 配置兼容与发行注意

新增 `theme`、`accentColor`、`borderWidth`、`lineHeight`、`letterSpacing`、`maxWidth`，以及 `viewportHeight`、`autoScroll`、`scrollSpeed`、`scrollStartPauseMs`、`scrollEndPauseMs` 和 `imageHeightPercent`。类型为可选以保留现有下游构造，服务端返回补齐默认值。旧 `card/letter/minimal` 值仍可读并映射为经典信笺；旧 `split` 现为文字双栏，图片按本次新规则固定在下方。新枚举为 `sidebar/portrait/focus`。边框仍由主题与边框设置负责。

配置仍保存在既有 `mail_live_channels.appearance` JSON 中，不新增表。新版本服务端严格校验字段、枚举、有限数值范围和十六进制颜色，拒绝任意 CSS/外链资源输入。外观操作不修改原文、审核快照、批准状态、队列或当前播放对象。

两站需要升级相同的 0.8.0 共享包，再使用对应桌面包保存外观。旧 0.7 服务端会拒绝新外观字段；反过来，新字段保存后直接回退到严格读取旧 JSON 的 0.7 服务端也会失败。回退必须事先验证兼容镜像，或在停写期间备份并仅转换外观 JSON；不得用整库旧备份覆盖上线后收到的新信。生产部署记录与设计阶段的隔离测试分开保存。

## 实际验证

9 月 20 日新增竖向排版与固定图片区的结果见 [竖向排版验收](DISPLAY-VERTICAL-VALIDATION.md)。下面保留的是此前版本的验证范围，不作为本次图片固定行为的证据；此前磁贴和热键结果见 [磁贴与展示验收](DESKTOP-TILES-VALIDATION.md)。

- `npm test`：共享库 **167/167** 通过，覆盖主题/排版、滚动配置、旧数据兼容、输入校验、审核与播放独立、动画取消、轮询不反复回顶、模块隔离与首次状态到达前紧急隐藏。
- `node --test apps/desktop/tests/*.test.cjs`：桌面单元与生命周期 **61/61** 通过。
- `node apps/desktop/node_modules/electron/cli.js scripts/display-designs-smoke.cjs`：真实 Electron **54 个组合**及长信完整循环、图片比例、底部说明、移除品牌、隐藏取消动画检查通过，0 控制台错误。
- `node scripts/run-management-smoke.cjs`（桌面目录）：**14 组**管理/外观回归，以及第二独立进程海报设置恢复通过。1920px 卡片按真实宽度预览，96px 字号配 280px 窄卡片时在固定 640px 视窗内自动滚到末字、末图和末说明。数据为合成站点，没有连接生产网站。
- `node apps/desktop/node_modules/electron/cli.js apps/desktop/scripts/display-viewport-smoke.cjs`：真实输出入口 **4 组**检查通过。900px 配置受较矮原生窗口约束，缩小到 300px 后仍能滚到最后图片说明；后台仍保持有效连接与滚动，隐藏后新连接保持空白。

隐藏、结束、连接失效时仍卸载整个观众卡片，取消滚动回调；切换快照或实际外观改动会回到顶部。正常状态轮询不会重复回顶。输出窗口保留 `backgroundThrottling: false`；休眠恢复继续执行展示连接失效与默认空白规则。

独立样板、单元测试与桌面界面测试不代表 OBS/直播姬实机窗口采集、真实系统按键或安装/卸载验收。本轮未运行安装器。

证据：[组合渲染报告](evidence/display-designs/verification.json)、[九种组合](evidence/display-designs/nine-combinations.png)、[UliUli 图文双栏](evidence/display-designs/uliuli-split.png)、[Mia 图文双栏](evidence/display-designs/mia-split.png)、[长信底部](evidence/display-designs/long-letter-bottom.png)、[竖图最后说明](evidence/display-designs/portrait-bottom.png)、[桌面操作报告](evidence/display-designs/desktop-management.json)、[独立进程恢复报告](evidence/display-designs/desktop-restart.json)、[输出尺寸报告](evidence/display-designs/output-viewport.json)、[小窗口底部](evidence/display-designs/output-small-window-bottom.png)。
