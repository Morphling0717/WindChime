# 展示主题与排版设计

2026-09-13。设计实现已进入共享组件；本轮交付自包含设计样板和开发代码，不自动替换线上网站或已发布的 Windows 0.7.1 安装包。目标功能版本为 0.8.0，manifest 在正式发行时统一升级。

## 设计结构

| 独立选择 | 首批选项 | 负责内容 |
| --- | --- | --- |
| 内容排版 | 纵向信笺、图文双栏、横向条幅 | 称呼、正文和图片的位置；双栏纯文字在窄宽度回到单栏，长文自然增长 |
| 视觉主题 | 纯净、UliUli 夜航、Mia 星祷 | 背景、颜色、边框、圆角、装饰及字体预设 |

每个主题适用全部三种排版。`applyLiveTheme()` 不修改布局、图片排列、字号、内边距、行高、字距、最大宽度或动画，编辑器也不自动改变这些设置。

长信自然增加卡片高度，不自动删字、截断或滚动播出；实际采集时仍需按画面尺寸调整字号与展示窗口。设计样板提供长信和窄宽度开关，便于提前检查。

- **纯净**：默认透明、白色文字、无装饰、无边框，保留现有简洁展示用途。用户仍可自行调整字体、颜色和背景。
- **UliUli 夜航**：参考 UliUli 的 `#050508` 深黑、`#2de2e6` 霓虹青与深蓝氛围，采用细描边、短折角、信号环和清晰黑体；装饰避开正文重点区域。
- **Mia 星祷**：参考 Mia 的 `#fbf6ec` 奶白、`#c4a96e` 香槟金及 `#2b2620` 墨色，采用双细线、淡拱窗、小星芒和宋体回退。

品牌依据来自两站现有 `app/globals.css`、`components/mail/mail-theme.ts` 和公开 UI。装饰使用内置 CSS/SVG，没有复制角色图片或远程背景。字体使用本机字体栈，不请求 Google Fonts，不宣称已捆绑 Noto 字体；在 Windows 上优先使用可用的微软雅黑/宋体等回退。

## 查看与使用

安装仓库根目录及 `apps/desktop` 依赖后：

```powershell
node scripts/build-display-designs.mjs
```

输出 `.work/display-designs/WindChime-Display-Designs.html`，可在浏览器离线打开。支持自由搭配、九组合总览、360/640/960px 宽度、图片、长信及隐藏示例。文件自包含且 CSP 禁止网络请求；示例信件和插图均为合成内容。

桌面源码的“设置与外观”已接入同一渲染器，可先预览再应用。预览画布按最大宽度扩展并等比例缩放；高字号或窄卡片产生长内容时，私人预览可用鼠标或键盘上下滚动查看完整文字及图片，不改变直播端的展示方式。未保存调整保留、跨控制端外观冲突需确认。旧站点缺少新版外观字段时，预览仍可使用，“应用外观”禁用并明确说明需要升级网站。

开发者可继续通过 `WindChimeLiveDisplay` 的 `render` 参数完全替换组件；默认 `WindChimeLiveCard` 及主题/排版工具从 `/broadcast` 导出。渲染器仍只接收当前已批准快照及已授权图片 URL。

## 配置兼容与发行注意

新增 `theme`、`accentColor`、`borderWidth`、`lineHeight`、`letterSpacing`、`maxWidth`；类型为可选以保留现有下游构造，服务端返回补齐默认值。旧 `card/letter/minimal` 值仍可读并映射为纵向信笺；旧信笺边线不再作为排版的一部分，改由主题与边框设置负责。

配置仍保存在既有 `mail_live_channels.appearance` JSON 中，不新增表。新版本服务端严格校验字段、枚举、有限数值范围和十六进制颜色，拒绝任意 CSS/外链资源输入。外观操作不修改原文、审核快照、批准状态、队列或当前播放对象。

正式发行需要两站升级相同的 0.8.0 共享包，再交付对应桌面包。旧 0.7 服务端会拒绝新外观字段；反过来，新字段保存后直接回退到严格读取旧 JSON 的 0.7 服务端也会失败。回退必须事先验证兼容镜像，或在停写期间备份并仅转换外观 JSON；不得用整库旧备份覆盖上线后收到的新信。本轮未连接或修改生产数据库。

## 实际验证

- `npm test`：最终共享库 **156/156** 通过，含外观 patch 独立性、持久化、旧配置兼容、非法输入、审核/播放独立、三主题与三布局内容及转义、旧站点保存提示、外观并发保护、预览尺寸及观察器清理。
- `node --test apps/desktop/tests/*.test.cjs`：桌面单元与生命周期 **48/48** 通过。
- `node apps/desktop/node_modules/electron/cli.js scripts/display-designs-smoke.cjs`：真实 Electron **54 个组合**通过（3主题×3布局×3宽度×纯文字/带图），0 控制台错误；确认列数适应宽度、文字与图片完整、无横向溢出、长信不裁切，隐藏时装饰一起移除。
- `npm run build`（`apps/desktop`）：桌面生产构建通过；`node scripts/run-management-smoke.cjs`（同目录）：真实 Electron 私人控制台 **14 组检查**通过，0 控制台错误。使用隔离配置与合成 HTTP 站点，验证外观预览不发保存请求、应用后保存、重新进入保留选择、换主题保留排版、取消话题切换保留未保存外观，以及宽窄窗口。另验证 1920px 卡片按真实宽度预览，96px 字号配 280px 窄卡片时可滚动看到末字、末图和末说明；第二个独立进程的海报设置恢复检查通过。以上不代表两站生产联调。
- 初次样板与新 SSR 测试发现已有 React 19.2.8 / React DOM 19.2.5 不匹配；固定开发依赖后重跑通过。注入断言曾误把已转义 caption 中的 `onerror` 当真实属性，改为检查真实标签/属性并加危险原始标签反例后通过；没有改成隐藏正文。

独立样板、单元测试与桌面界面测试不代表 OBS/直播姬实机窗口采集或安装/卸载验收。本轮未运行安装器。

证据：[组合渲染报告](evidence/display-designs/verification.json)、[九种组合](evidence/display-designs/nine-combinations.png)、[UliUli 图文双栏](evidence/display-designs/uliuli-split.png)、[Mia 图文双栏](evidence/display-designs/mia-split.png)、[桌面操作报告](evidence/display-designs/desktop-management.json)、[独立进程恢复报告](evidence/display-designs/desktop-restart.json)、[桌面宽窗口](evidence/display-designs/desktop-mia-wide.png)、[桌面窄窗口](evidence/display-designs/desktop-uliuli-narrow.png)、[长内容底部预览](evidence/display-designs/desktop-tall-bottom.png)。
