# 风铃 0.6 本轮实施与验证记录

> **历史验收记录。** 下文保留当时版本、范围和实际结果；其中的「本轮」均指该次历史验证。本轮独立桌面窗口版的当前证据见 [DESKTOP-LOCAL-VALIDATION.md](DESKTOP-LOCAL-VALIDATION.md)。旧平台相关结果或待办不作为当前本地桌面流程的前置条件。

日期：2026-09-10 至 2026-09-11（Asia/Shanghai），本次汇总更新于 09-11 00:45。使用合成信件及隔离 SQLite；没有读取或修改主播生产信箱、没有使用真实平台密钥、没有部署或发布 npm。旧 `docs/VALIDATION.md` 中 0.5 的历史结论不计入本次验收；下表标为“修复前基线”的本轮证据保留，但不冒充最新修复后的全量复验。

普通独立展示、两站基础浏览器流程、桌面真实配对/同步/重启和 OBS 浏览器源已取得实测通过证据。中文链接规范化的最新 UI 修复已通过构建和针对性测试，尚待两站服务重启后的浏览器复验；真实直播姬接入和平台审核仍未完成。

## 环境与代码

- Windows 11 Home Single Language x64，10.0.26200.9168。
- 共享库与网关验证 Node 22.22.3；两站验证 Node 20.20.2。两站仍遵循各自 `engines` 的 Node 20.x。
- WindChime 基线 `8efc480`，新库版本 0.6.0；Next_UliUli 基线 `1288e3d`，Next_Mia 使用本轮取得的公开主分支。三仓均在 `codex/live-broadcast` 分支修改，未推送。
- UliUli 为 Next 16.2.12；Mia 为 Next 16.2.7。桌面 Electron 44.3.0 / Forge 7.11.2。
- 每站一个持久进程、一份临时 SQLite、独立私有媒体目录。此测试不证明无状态或多副本部署可用。

## 已执行的自动验证

| 范围 | 实际命令 | 结果与范围 |
| --- | --- | --- |
| 通用库 | `npm run build`、`npm run typecheck` | 通过 |
| 全部库测试（本轮修复前基线） | `node --test tests/*.test.mjs` | 64/64 通过，无跳过；原业务、审核、图片、权限、并发、接收器及编辑冲突，含客户端切换不可渲染一帧旧信箱内容的回归。此数字不包含后来新增的 4 项规范化/保存竞态测试 |
| 最新审核 UI 修复 | `npm run build`、`npm run typecheck`、`node --test tests/broadcast-ui.test.mjs` | 构建、类型检查通过，UI 6/6；中文 URL/空白规范化不再假冲突，保存中输入不丢失，较新远端修改和已明确确认的版本不被迟到响应覆盖 |
| 最新共享接收器与 UI | `node --test tests/broadcast-receiver.test.mjs tests/broadcast-ui.test.mjs` | 11/11，通过；包含上一行 UI 6 项，不重复计为新增 11 项。覆盖租约、迟到响应/图片、撤销、重连空白及编辑保护 |
| 其中后端与直播 | `node --test tests/backend.test.mjs tests/live.test.mjs` | 36/36；包含实际 Node 子进程退出/重启、SQLite 持久批准/顺序、空白新 epoch |
| 独立包安装 | `npm run pack:check` | 最新规范化修复后再次通过；在全新目录安装 tarball，导入包括 `/broadcast` 的各入口，建立 SQLite 并做严格 TS 消费者编译。修复旧脚本在 Windows 无法直接 spawn npm.cmd 的问题 |
| UliUli / Mia 原业务 HTTP | 各站 `npm run test:mail` | 两站均通过：原 session、旧密码接口、公开 DTO/SSR、投稿、分类、收藏、旧审核、归档恢复、批量、屏蔽解除、设置 |
| UliUli / Mia 直播 HTTP | 根库 `node scripts/test-live-http.mjs`，分别指向 3011/3012 | 各 50 项断言通过；未审拒播、批准不播放、手动上屏/下一封/隐藏、撤销、改稿重审、重开空白、队列保留、话题和展示权限隔离 |
| 两站 HTTP 补充与互相隔离 | 根库 `node scripts/test-live-http-extended.mjs` | 335 项主流程断言通过，退出码 0；跨站/话题令牌、当前图片与 SHA-256、收据范围/复用、CORS、并发版本、迟到 show 重放、3 秒失效/重连、阅读状态/队列保留、旧后台操作撤下、设备派生授权撤销。详见 [补充报告](HTTP-EXTENDED-VALIDATION.md) |
| 两站迁移 CLI | 各站 `npm run test:mail:migrations` | 各 3 场景（新库、旧无话题库、已有话题库）重复迁移两次，全部通过；信件 ID、原文、已读、收藏、标记、话题、屏蔽与宿主 sentinel 保留 |
| 两站生产构建（本轮修复前基线） | 各站 Node 20 运行 `next build --webpack` | 两站通过，包括 TS 和所有路由生成；Mia 原 PWA route 存在不允许的 contentType 导出，已移除该无用导出，ImageResponse 行为保留。最新规范化 UI 修复后的两站重建/运行复验见下方待办 |
| 独立 Next 示例 | `examples/next-sqlite`: `npm run build` | 通过；审核网页和展示页使用不同根布局，原 `/admin`、投稿和话题页保留 |
| 原二维码和海报导出 | 真实 Chromium 调用打包后的 `/media` API | 7 项断言通过，实际生成 320×320 二维码和 900×1395 PNG 海报；PNG 684547 字节、文件签名正确，并已目视核对。原站点下载按钮未在本轮重新逐一点击 |
| B 站网关 | `npm run build`、`npm run check`、`npm test` | 通过；14/14，使用受控平台响应，覆盖签名、生命周期、错误、绑定范围、重放及刷新参数 |
| 网关与站点真实协议 | `npm run test:integration` | 1/1；真实 Ed25519 签名器 → Next handlers/SQLite，含绑定/重放、展示交换、批准不播、手动播、续期、scope/主体/会话错误、过期空白、解绑 |
| 桌面原生权限与竞态 | `apps/desktop`: `npm test` | 最新 9/9，通过 URL、配对、IPC、话题和管理凭据边界，以及切换连接、旧窗口回调、旧请求、平台租约失败和迟到写入后的隐藏检查 |
| 实际 Electron 窗口 | `npm run test:smoke` | 12 检查通过，两个真实隔离窗口，页面错误 0；本机 HTTP fixture，不冒充真实平台或真实网站联调 |
| Electron 与两站真实适配器 | `apps/desktop`: `npm run test:sites` | UliUli/Mia 各两个话题，四次真实浏览器确认 PKCE；网页管理 API 与桌面 IPC 双向同步通过；退出第一 Electron 进程，以同一加密 vault 启动第二进程，授权/批准/顺序保留，首启与新展示窗口均不恢复旧信。详见 [桌面报告](../apps/desktop/VALIDATION.md) |
| 浏览器复验脚本交付 | `scripts/browser-acceptance/{open,basic,network}.js`、`run.ps1` | JS 各阶段内容在真实 Tabbit 中执行，基础/断网结果见下文；新 PowerShell 包装器只做语法检查，不宣称完整运行器已端到端执行。准备数据脚本为 `scripts/prepare-browser-fixtures.mjs` |
| OBS 正式 API 与浏览器源 | `apps/live-gateway`: `node scripts/test-obs-capture.mjs` | 10/10 通过；隔离便携 OBS 32.0.1、obs-websocket 5.6.3，真实 PNG 合成证明透明背景、批准不播、手动播、隐藏和撤销。未开播、录制或启动虚拟摄像头；详见 [采集报告](LIVE-CAPTURE-VALIDATION.md) |

写入类 HTTP 测试只允许 localhost 且需显式 `*_ALLOW_WRITES=1`。`MAIL_SMOKE_*` 用于站点原业务脚本，`WINDCHIME_SMOKE_*` 用于根库直播脚本；具体变量见脚本开头及两站 `docs/WINDCHIME-LIVE.md`。

## 浏览器实际观察

Tabbit 真实 Chromium 中，两站均通过原登录、`/mail/live` 加载、新信默认空白、批准后不播放、审核后的正文/昵称/两张图片及说明手动上屏、切换下一封、队列末尾空白且保留批准顺序、刷新后先空白再手动上屏、撤销当前批准立即撤下，以及结束展示保留队列。独立展示页透明、无 Service Worker、无收件箱请求、无私人控制元素。完整观察与测试脚本校准说明见 [浏览器报告](LIVE-BROWSER-VALIDATION.md)。

两站分别实测 8 次从隐藏请求成功响应到 DOM 清空的时间：UliUli 462.4–922.0 ms，Mia 473.4–898.6 ms；16 次样本均小于 1 秒。静默网络中断后，UliUli 2627.6 ms、Mia 2604.8 ms 清空，均小于 3 秒；显式断线及重连不恢复、freeze/resume 事件后的空白均通过。这些是本机样本和事件测试，不是所有机器的延迟保证，也不是实际操作系统睡眠恢复。早期 1490 ms 读数从自动化点击调用开始计时，包含定位/滚动，不与本轮响应后计时混为一谈。

此前刷新丢失 fragment 中只读重连参数的问题已修复；普通展示页刷新后重新连接/手动上屏已在两站真实浏览器通过。H5 父壳签发新 proof 只有模拟/契约证据，仍无真实平台容器结论。

后续浏览器编辑场景发现产品问题：服务端对中文 URL 编码、裁剪首尾空白后保存成功，旧编辑器却因 JSON 字面比较误报远端冲突。已改为使用本次 action 的确切响应版本作为基准，并保留保存期间的后续输入和真实远端冲突保护；最新 UI 6/6 与共享 11/11 已通过。两站磁盘上的最新 tarball、lockfile 完整性和 175 个 dist 文件已核对一致，但截至本次记录，3011/3012 仍分别为旧运行进程 PID 53004/22336，不能称最新 UI 已被浏览器复验。

对上述精确测试 PID 的 `Stop-Process` 返回 Windows `Access is denied`，没有替代终止或提权；已请用户执行工作区 `.work/Stop-LiveTests.ps1`。待用户停止后，才能完成最新两站生产重建与浏览器复验。更早的服务启动曾被自动审批以 `blocked by policy` 拒绝，用户手动启动后已解除当时阻塞；这是历史记录，与当前 Windows 拒绝停止不同。网关已由用户重启为 PID 55904，健康检查和实际静态文件匹配最新代码，详见采集报告。

后续空闲后 Tabbit task 重置，恢复原任务组/claim 返回 `PAGE_ATTACHMENT_TIMEOUT`，该浏览器任务已正常结束，没有继续重试；空的页面集合所返回的空结果不计作任何验收通过。已通过的基础观察仍保留，未完成的后续编辑流程仍待复验。

浏览器收尾仅对本轮 fixture 文件记录的两个自建话题执行 end，并各撤销一份本轮“直播展示页”只读授权；合成信件保留。结果在工作区 `.work/runtime/browser-cleanup.json`，未更改其他话题或授权。

## Windows 包与透明性

安装程序和便携 ZIP 由 `apps/desktop/npm run make` 生成，稳定交付目录为 `apps/desktop/out/installers/`。Squirrel 资源工具不兼容本工作区中文打包路径的问题已通过独立 ASCII 临时构建目录修复。

最新安装程序 153630720 字节，ZIP 158209836 字节。本次重新对实际文件计算 SHA-256，与同目录 `SHA256SUMS.txt` 一致：

| 文件 | SHA-256 |
| --- | --- |
| `WindChime-Setup.exe` | `589838E19121B43A278F09C62FDC3570B2DCCAE4F7344D37C24AA8B379D00BC3` |
| `WindChime-win32-x64-0.6.0.zip` | `B60D0F1F181DAE1DE42B39A3AF56E96870DCEA48D1687E1A532DC093BF7BADB3` |

`RELEASES` 与 nupkg 的大小及哈希也保存在 `SHA256SUMS.txt`。最终包包含最新共享组件修复，但“能够生成安装包”与“该最终包已实际完成安装/卸载往返”分别记录。

本轮在确认原 `%LOCALAPPDATA%/WindChime` 不存在后，实际安装成功（退出码 0），安装后启动成功，检查单实例及未连接时私人初始界面。ASAR 运行白名单不含 `.env`、测试数据、平台密钥及开发工具；运行文件与构建产物核对一致。

首次卸载发现托盘进程占用安装文件，已补 Squirrel 卸载启动通过单实例转交关闭原进程，再生成最终包。修复后的清理测试残留目录并重装/卸载命令被自动审批拒绝，理由仅为 `blocked by policy`；没有重试或绕过。**最终卸载修复尚未实际复验**，不能将早期安装测试视为最终包全部验收通过。

Electron 自有窗口截图位于 `apps/desktop/out/smoke/`，报告为 `report.json`；展示截图 RGBA 透明区域 alpha 为 0。另一次独立的 OBS 浏览器源测试已取得真实采集合成证据：未审/批准未播放时 921600 个像素全部透明，手动上屏后有审核正文和图片，透明区域露出两种棋盘背景；隐藏和撤销后全透明，单次响应到空白 PNG 为 924 ms。此证据覆盖 OBS 浏览器源，不覆盖 OBS 对 Electron 窗口捕获或直播姬。原生窗口截屏中被遮挡的其他应用内容仍被排除为无效证据。

## 仍需完成的条件

1. 用户停止旧测试站进程后，完成最新 UI 修复的两站生产重建和浏览器复验；尚未通过的后续编辑/图片场景不能预记为通过。真实站点与桌面共同操作、两个独立 Electron 进程之间的重启验证已经通过，不再列为待做。最终安装包安装/运行中卸载往返仍待实测。
2. 真实 B 站接入：核实密钥属于通用开放平台还是直播创作者服务中心、H5/桌面项目 ID、所需 API 权限、HTTPS/来源与测试房间许可。当前无可用项目配置和真实 API 成功证据。
3. 在真实直播姬中核对签名启动、iframe/设置场景、关闭/重启、平台生命周期及实际采集；OBS 浏览器源已通过，但 OBS 对 Electron 窗口捕获、直播姬采集、真实操作系统睡眠恢复仍未执行。自动接收器和 freeze/resume 事件测试不替代这些实机测试。
4. 平台审核上架、生产迁移部署、npm 发布、Windows 代码签名、自动更新服务和 macOS 包未执行。Docker 本机不可用，已交付配置，未执行容器运行验证。

当前证据分别为：共享业务/隔离授权通过自动与两站 HTTP 验证；普通展示基础流程通过两站浏览器和 OBS 浏览器源实测；桌面通过真实四话题配对、同步与进程重启；最新 UI 修复有针对性测试但待两站新运行构建复验；早期 Windows 包安装启动通过而最终包往返未验；B 站为模拟契约通过，真实直播姬接入与审核上架均未完成。
