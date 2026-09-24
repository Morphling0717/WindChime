# 独立 Windows 桌面版验收

日期：2026-09-11，Asia/Shanghai。本轮范围是桌面直接连接网站、独立窗口捕获；B 站官方启动、H5 和审核上架已退出交付范围。未读取、更改或调用真实平台密钥，未修改已创建的 H5 项目。

## 代码与构建：通过

- 共享库 `npm test`：最终 79/79；`npm run typecheck`：通过。新增三项 UI 行为测试确认平台入口默认关闭、显式开启可用，未配置展示地址时不出现链接入口；另有八项计时测试覆盖可配置轮询、边界、慢请求与清理。
- 桌面 `npm test`：最终 25/25；`node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`：通过。覆盖挂起/失败的网站隐藏、纯透明待机文档、迟到加载与窗口切换，以及无法重建透明帧时关闭捕获窗口。
- 桌面 `npm run test:smoke`：中间修复版真实 Electron 19/19，控制台错误 0。所有 fetch 只访问所选临时站点；`code=` 参数被忽略，无平台或网关请求。报告 `apps/desktop/out/smoke/report.json`。其后最终 500 ms 轮询和主动透明帧版本另经下文真实 OBS 故障采集及 25 项桌面测试验证，不把中间版的时序数据称为最终版重跑。
- 保留的检查包括原文仅私人可见、只读 IPC、跨话题拒绝、默认空白、批准不播、手动展示、撤销、刷新与断线清空、旧 v1 凭据兼容、切换竞态以及快捷键失败提示。休眠事件测试是模拟事件，不等于实际 Windows 睡眠测试。
- 按 React 组件检查清单检查了界面变更：保持 Hook 调用顺序与清理、显式可选功能、错误提示只在私人窗口、Logo 不重复提供可访问名称；未引入外部脚本或新业务数据存储。

## 两站生产构建与隔离环境

两站固定使用相同 `windchime-embed-0.6.0.tgz`，214217 bytes，SHA-256：`3FCF4D69D0422AF7ACDCABB9E99BB64820659B4C1978099E8A8122617F84271E`。最终包增加可选轮询间隔；和下列正在运行的测试构建比较，175 个编译文件中仅 6 个 broadcast 展示/receiver 的 JS 与声明文件变化，其余 169 个（含全部 server/next/sqlite/media/core/client/react）逐字节一致。桌面明确使用 500 ms，共享展示默认仍为 1000 ms。

| 站点 | 测试地址 | 独立构建 ID |
| --- | --- | --- |
| UliUli | http://localhost:3021 | `fg6YZ6qrArqC1xjY9xcRu` |
| Mia | http://localhost:3022 | `kULgcyIT5wT9GTfhuxogy` |

两个生产构建成功，有 Next NFT 文件追踪范围警告，无编译错误。新增可选 `WINDCHIME_BUILD_DIRECTORY`，默认仍是 `.next`，验收使用 `.windchime-desktop-test`，只接受单个受限相对目录。

最终 tar 安装后又在 `.windchime-desktop-final` 独立完成两站生产构建：UliUli `lNOq4otVD2fQsnEtyeHR1`，Mia `0PwPZ00QVOJjRNntbLha6`，均退出 0。UliUli 的 463 个、Mia 的 469 个已安装依赖版本和锁文件一致；UliUli 20 项 `libc` 元数据保留。构建自动追加的临时 tsconfig include 已还原到构建前字节，没有覆盖上表仍在运行的验收构建。证据 `.work/runtime-desktop/final-build-verification.json` 与 `production-final-{uliuli,mia}.log`。

新数据库与图片在工作区 `.work/runtime-desktop/`，不与旧进程共享数据库。启动命令由 `.work/start-desktop-tests.cjs` 固定传入 Node 20、测试数据库/盐/会话配置及空的展示 URL/平台字段，禁用自动载入站点环境文件。未停止或改写原 3011/3012 进程的 `.next`。旧网关虽仍在运行，本轮桌面及新站点不使用它。

## 安装包：已生成，安装往返待验

`apps/desktop` 执行 `npm run make` 成功，生成安装程序、ZIP、nupkg 和 RELEASES。Logo 已导出包含 16、24、32、48、64、128、256 像素的 ICO，同时用于应用、托盘和安装程序。

| 文件 | 大小（bytes） | SHA-256 |
| --- | ---: | --- |
| WindChime-Setup.exe | 154132992 | `D527E1255E61F5F9105EC481F3206B1EE2B9BE89F8EB052D02F7114BD2605FCA` |
| WindChime-win32-x64-0.6.0.zip | 158410603 | `672E289A594EFEB30DD651B7694773B8FE28CAAF407F7A5AED582FE9DA877A2B` |

最终构建在 `windchime-make-HlvSYv`，包含 500 ms 轮询及等待网站响应期间主动绘制透明帧的修复。对实际 `app.asar` 的 13 个目录/文件条目检查，没有环境文件、密钥、数据库或测试脚本；主程序、preload、界面与图标的 8 个关键文件和最新构建逐字节一致。报告 `apps/desktop/out/installers/package-verification.json`。

前一次 `windchime-make-ACvcih` 的 `WindChime.exe` 实测：交互方式首次启动正常显示带 Logo 的私人控制台，没有自动创建展示窗口；重复启动唤起原实例；关闭控制台后进程保留托盘，再次启动恢复同一窗口句柄；通过原生 File → Exit 正常退出，进程确认消失。测试前确认默认配置中没有设备凭据，结束后也未产生凭据。证据 `packaged-first-launch.jpg`、`packaged-startup.jpg`。初次测试以 Windows 隐藏样式启动，因此随后另以正常交互样式复验首次启动；不把测试启动方式导致的隐藏算作程序故障。此处是打包后的可执行程序验证，不能代替 Squirrel 安装/卸载往返。

本轮只读检查确认 `%LOCALAPPDATA%/WindChime` 仍有旧测试残留（`app-0.6.0`、`.dead`、`Update.exe`）。此前“清理残留后重装”被自动审批以 `blocked by policy` 拒绝，未提供具体原因；本轮没有重试清理、改名或换工具绕过。最终安装及托盘运行时卸载仍未验证。

最终 HlvSYv 包再次实际启动（PID 63748），原生枚举仅有私人控制台；无配置时未自动打开输出。因同时运行故障采集进程占用快捷键，快捷键注册失败仅出现在私人界面，直播源仍只有已批准合成信件。File → Exit 正常退出，进程确认消失；默认设备凭据在运行前后均不存在。截图 `out/installers/packaged-final-first-launch.jpg`，过程元数据 `.work/runtime-desktop/packaged-final-process.json`。没有再次执行安装/卸载。

## 实际窗口采集：单独验收

新增 `apps/desktop/scripts/capture-window.cjs`，使用真实桌面主程序、真实测试站点、合成信件/图片和独立便携 OBS，通过受认证的正式 obs-websocket API 操作，不使用浏览器源代替窗口捕获。

OBS 32.0.1 使用 WGC `method=2`、严格标题匹配 `priority=1`，窗口参数来自 OBS 的真实枚举。严格标题匹配是为了防止展示窗口关闭后改捕获同 exe 的私人窗口。依据 [OBS 标题匹配源码](https://github.com/obsproject/obs-studio/blob/32.0.1/libobs/util/windows/window-helpers.c#L400) 与 [WGC 渲染源码](https://github.com/obsproject/obs-studio/blob/32.0.1/libobs-winrt/winrt-capture.cpp#L471)，实际像素仍需实测。

用户已亲自确认直播姬的 Windows 权限弹窗并添加测试窗口捕获。直播姬 7.54.0.10521 的“场景 7”实际显示了已审昵称、正文和图片，未开播。工具可以读取画面，但此前输入曾遇到进程完整性级别不同，未提权或绕过。

### 初次窗口验证暴露的问题（修复前证据）

OBS 短流程 12 项通过，窗口背景 alpha 保留，前台隐藏响应后 127 ms 清空。实际像素验收又发现了场景裁剪、HDR 色彩偏暗，分别通过先设置画布及明确源变换、启用 `force_sdr=true` 修正。修正后测试图片像素与原规范化图片相同（143/225/213）；透明区域透出棋盘底色（24 与 42）。早期失败报告与截图保存在 `apps/desktop/out/window-capture/attempt-*`，未把这些失败结果删除。

延长运行并由直播姬覆盖展示窗口后，02:32:25 后台隐藏接口返回 200，网站状态为 `current=null`、`receivers=0`，但直播姬、直接窗口截图及 OBS 当前源截图仍保留旧画面。因此初次短流程通过不足以证明长期捕获安全，修复前包不能作为最终交付版。退出该测试进程后直播姬清空，未改捕私人控制台。证据：`livehime-01-shown.jpg`、`livehime-02-hidden.jpg`（此张实际为隐藏失败）、`livehime-crosscheck-obs.png`、`livehime-03-process-exited.jpg`。

### 已完成的修复与复测

展示窗口设置 `backgroundThrottling:false`，主进程按请求发起时间独立检查租期，原生隐藏并丢弃旧渲染进程。紧急隐藏不等待网站请求返回；网站完成隐藏前不会创建新展示连接。当前快照被撤下、授权失败、旧 receiver 响应和隐藏期间迟到事件均有保护。

真实 Electron 又暴露了立即 `forcefullyCrashRenderer()` → `reload()` 的竞态。独立最小探针中，立即重载会超时，等待 `render-process-gone` 后重载约 92 ms 完成，保持同一 HWND 且私人进程不受影响。主程序已改为等待退出确认再重载；恢复后新连接默认空白。探针报告 `.work/runtime-desktop/recovery-probe-h3P3y5/report.json`。

修复后的 Electron smoke 连续完整遮挡 65,009 ms，收到 65 次 frame 确认；后台 HTTP 隐藏后原生窗口约 783 ms 隐藏、响应后 933 ms DOM 清空，截图 alpha 全为 0。故意无限循环卡死展示 renderer，主进程 2888 ms 原生隐藏，恢复后透明像素全部为 0，不恢复旧信；断线 1055 ms 清空。对应 `occluded-hide.png`、`watchdog-recovered.png`。这仍不代替下面的真实 OBS 长时间捕获结果。

### 最终实际像素验收：通过，直播姬透明叠加仍待验

真实 OBS 完整遮挡 900,010 ms 后展示连接仍在线，后台隐藏也清空，但像素测量超过 1 秒目标。报告保留为 `out/window-capture/15-minute-before-poll-tuning.json`。因此桌面轮询从 1000 ms 改为 500 ms，库默认不变。

随后故障注入又发现：站点隐藏请求挂起时，仅隐藏并终止 renderer 会使 WGC 缓存旧帧。最终改为立即加载 CSP 禁止脚本和网络的纯透明文档，在同一 HWND 主动绘制空帧；这时不建立展示连接。站点成功执行隐藏后再加载正常展示组件，新 receiver 仍为空白。透明文档无法建立则关闭该窗口。主进程给重绘及采集预留 400 ms，不放宽 3 秒清屏验收线。首次失败保留为 `out/window-capture-faults/attempt-1-stalled-hide.json`。

最终执行 `electron scripts/capture-window.cjs`，配置 `WINDCHIME_CAPTURE_MODE=faults`、`WINDCHIME_CAPTURE_HOLD=1` 及前述隔离站点/受认证便携 OBS。**20/20 项通过，退出 0**；该轮是短时故障采集，不冒充再次完整运行 15 分钟。所有清屏时间来自 OBS 实际窗口源像素，非 CSS、DOM 或 `isVisible()` 推断：

| 场景 | 实际像素结果 |
| --- | --- |
| 普通隐藏 | 响应后 138 ms；命令后 360 ms |
| 远端后台隐藏，窗口被覆盖 | 响应后 612 ms |
| 网站隐藏请求故意挂起 | 命令后 238 ms；挂起期间没有建立新 receiver |
| 静默断线 | 2539 ms 清空 |
| renderer 无限循环卡死 | 最后一次 frame 请求发起后 2943 ms 清空 |
| 断线/renderer 恢复 | 维持透明，直到新手动上屏 |
| 关闭/重新打开输出 | 不捕获私人窗口；重开空白，新手动上屏成功 |
| 透明背景 | 显示时 595122/614400 像素透明；隐藏后全部透明 |

未审核/仅批准始终空白，手动显示、图片、撤销正常，无平台或网关流量。结束时确认推流、录制、虚拟摄像头和回放缓存均未启动，夹具授权全部撤销。报告 `apps/desktop/out/window-capture-faults/report.json`，日志 `.work/runtime-desktop/native-capture-faults-final.log`。便携 OBS 测试进程随后关闭，并停用它自己的测试 websocket；用户原 OBS/直播姬实例未关闭。

直播姬 7.54.0.10521 的用户测试“场景 7”在最终代码下实际完成显示→网页隐藏清空→重新手动上屏→再次隐藏清空，没有控制台、登录或错误详情进入采集。截图为 `out/window-capture-faults/livehime-final-{shown,hidden,reshown,second-hidden}.jpg`。本机工具点击素材入口没有打开设置窗口，未提权或绕过，无法在预览中添加对比背景来确认 alpha；黑色底上的空白不能证明透明。因此**直播姬透明叠加、完整关闭/重开矩阵以及像素级时延测量仍待单独验收**，OBS 的透明通过不能替代。

## 两站 HTTP 与网页操作：通过

以 Node 20.20.2 在 3021/3022 隔离服务运行 `scripts/test-live-http-extended.mjs`，335 项通过；`scripts/test-live-http.mjs` 各站 51 项通过。三次命令均退出 0，无夹具清理失败。覆盖媒体授权、快照失效、跨站/话题、并发版本、租期、撤销、删除归档、设备父授权失效等。日志在工作区 `.work/runtime-desktop/http-extended.log`、`http-basic-uliuli.log`、`http-basic-mia.log`。

通过 Tabbit 真实网页登录，每站完成 8 组界面检查：展示稿保存、中文链接和空白规范化、批准只入队、无展示端时禁用上屏、编辑撤销批准、并发冲突保留本地草稿、明确确认远端版本后保存、默认不出现平台/未配置展示链接入口。两站共 16 组通过，报告 `.work/runtime-desktop/web-ui-report.json`。这些网页检查不代替后续桌面 PKCE 配对与独立进程重启测试。

两站各执行 `npm run test:mail` 与 `npm run test:mail:migrations`，均退出 0（02:42:56–58 CST，Node 20.20.2）。HTTP 回归明确指向 3021/3022：登录和兼容鉴权、公开 DTO/SSR 隐私、投稿/筛选、话题隔离、收藏、归档恢复、旧审核/批量操作、封禁解禁和设置通过。迁移各使用 fresh/legacy/current 三种临时数据库，每种连续迁移两次，两站共 12 次迁移通过，旧信件与宿主哨兵数据保留。日志为 `.work/runtime-desktop/test-mail-{uliuli,mia}.log`、`test-mail-migrations-{uliuli,mia}.log`，没有对生产库演练。

## 四话题配对与两个真实桌面进程：通过

`apps/desktop` 执行 `npm run test:sites`，设置 `WINDCHIME_SMOKE_ALLOW_WRITES=1`、两站 origin 为 3021/3022、隔离测试口令，并指定测试专用标题 `WindChime Pairing Verification`，避免与长时间 OBS 捕获的正式标题冲突。所有四个 PKCE 码通过已登录的真实网页按钮批准，原生主程序完成兑换。

第二次完整运行成功，报告 `apps/desktop/out/site-smoke/first-report.json`、`restart-report.json`；网页批准证据 `.work/runtime-desktop/desktop-browser-pairings.json`。每站两个话题均验证：原稿保留、主进程上传且实际解码规范化 WebP、网页和桌面同步、批准不播放、手动上屏、下一封到末尾不循环、隐藏/结束、撤销与修改图片说明重新审核、排序与已读/收藏保留、旧版本返回 409 `REVISION_CONFLICT` 且状态不变、跨话题请求拒绝。

第一次运行因 `close()` 返回后立即要求旧窗口对象消失而失败。修正验收脚本后实测：切换返回时旧窗口均已不可见，原生 `closed` 事件随后约 540–548 ms 到达；期间没有旧窗口重新显示，私人窗口未被误认。首次失败未计为通过，其测试授权已撤销。

| 话题 | 网页隐藏响应→新空白 DOM | 桌面隐藏→原生隐藏 | 桌面隐藏→新空白 DOM |
| --- | ---: | ---: | ---: |
| UliUli A | 987 ms | 3 ms | 167 ms |
| UliUli B | 883 ms | 2 ms | 163 ms |
| Mia A | 872 ms | 3 ms | 150 ms |
| Mia B | 926 ms | 2 ms | 156 ms |

上述桌面隐藏均在控制响应返回前清空；这些是本地实测，远程网站还包含网络时延。first 进程请求仅访问 UliUli 273 次、Mia 244 次；restart 进程分别 34、6 次，额外来源和平台请求均为 0。

first 使用不执行正常清理的退出模拟进程重启，restart 为新的 Electron 进程并复用加密 v1 凭据。四个连接、批准与排序保留，启动无展示窗口；即使独立观察端正在展示，重开的桌面展示端仍为空白，只有新手动上屏才显示。结束后本轮四个话题的测试授权全部撤销，合成信件保留供复核。
