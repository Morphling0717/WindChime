# 网关重启与采集验证补充记录

> **历史验收记录。** 下文保留当时版本、范围和实际结果；其中的「本轮」均指该次历史验证。本轮独立桌面窗口版的当前证据见 [DESKTOP-LOCAL-VALIDATION.md](DESKTOP-LOCAL-VALIDATION.md)。这里的浏览器源采集证据不替代桌面窗口捕获验收，旧平台相关结果或待办也不作为当前本地桌面流程的前置条件。

日期：2026-09-11，Asia/Shanghai。此记录只描述本轮实际取得的证据；总体浏览器、桌面与业务测试见 [LIVE-VALIDATION.md](LIVE-VALIDATION.md)。没有使用真实 B 站密钥，没有开播。

## 网关代码验证：通过

工作目录：`C:\Users\ASUS\Documents\ChatGPT\风铃\WindChime\apps\live-gateway`。

本轮重新执行：

```powershell
npm run build
npm run check
npm test
npm run test:integration
```

结果：构建与语法检查通过，网关测试 **14/14** 通过，真实签名与站点契约集成 **1/1** 通过，均无跳过。网关测试的 B 站 API 使用受控响应；集成测试使用真实 Ed25519 签名器、Next handlers 和隔离 SQLite，不是实际 B 站平台调用。

刷新相关测试确认：普通 `/display` 仅保留 `siteBaseUrl` 和只读 `token`，未知 fragment 字段和查询参数被清除；刷新后可重新连接，接收端仍需手动上屏。H5 刷新不保留已经消费的 proof，保留目的地及父窗口桥标识，由仍有效的父壳签发新的短时 proof。上述是代码和契约验证，不代表真实 H5 容器桥接已经通过。

## 3390 进程归属确认，用户重启后已复核

只读证据：

- `127.0.0.1:3390` 只有一个监听进程，PID **50464**，名称 `node.exe`。
- 进程创建时间为 **2026-09-10 22:31:47**；父进程 PID 17136，名称 `cmd.exe`。系统没有向本次查询返回这两个进程的命令行或可执行文件路径，未推测这些缺失字段。
- `http://127.0.0.1:3390/healthz` 返回 `{"ok":true,"protocolVersion":1}`。
- 实际请求 `/h5.mjs` 的内容，与 `apps/live-gateway/public/h5.mjs` 完全相同；响应包含 `Referrer-Policy: no-referrer`。

实际使用的只读命令包括：

```powershell
Get-CimInstance Win32_Process -Filter 'ProcessId = 50464'
Get-NetTCPConnection -LocalPort 3390 -State Listen
Invoke-WebRequest -Uri 'http://127.0.0.1:3390/healthz'
Invoke-WebRequest -Uri 'http://127.0.0.1:3390/h5.mjs'
```

本轮用户批准收尾后，在同一命令中再次检查唯一监听 PID、回环地址、进程名称和静态文件内容，全部匹配后，仅尝试一次精确停止：

```powershell
Stop-Process -Id 50464 -ErrorAction Stop
```

Windows 返回：

```text
Cannot stop process "node (50464)" because of the following error: Access is denied.
```

这是操作系统拒绝访问，与前一轮自动审批返回的 `blocked by policy` 不同。该进程没有被本轮停止；没有提权、杀父进程、使用替代工具终止或另开等价服务。更新后的静态资源可以由当前服务读取，但不能由此宣称旧进程已经重新加载最新 `server.mjs`。

随后用户手动重启了网关。只读复核时，3390 的唯一回环监听进程已变为 **PID 55904**，创建时间 **2026-09-11 00:27:43**，晚于 `apps/live-gateway/src/server.mjs` 最后修改时间 **2026-09-10 22:40:04**。`/healthz` 再次返回成功，实际 `/h5.mjs` 再次与本地最新文件相同。此次没有再停止或重启网关；先前的 Windows 权限阻塞由用户操作解除。该运行复核仍不代表真实 B 站 API 或平台容器联调成功。

## 采集软件定位与 OBS 启动路径偏差

注册表和本地文件版本取得以下信息：

| 软件 | 版本 | 实际安装程序路径 |
| --- | --- | --- |
| OBS Studio | 32.0.1 | `C:\Program Files\obs-studio\bin\64bit\obs64.exe` |
| 哔哩哔哩直播姬 | 7.54.0.10521 | `C:\Program Files\bililive\livehime\7.54.0.10521\livehime.exe` |

确认路径与版本时使用 `Get-ItemProperty` 读取 Windows 卸载注册表条目，并用以下命令核对文件：

```powershell
Get-Item 'C:\Program Files\obs-studio\bin\64bit\obs64.exe',
  'C:\Program Files\bililive\livehime\7.54.0.10521\livehime.exe' |
  Select-Object FullName,@{Name='FileVersion';Expression={$_.VersionInfo.FileVersion}}
```

根据之前查阅的 [OBS 便携模式说明](https://obsproject.com/kb/portable-mode) 与 [启动参数说明](https://obsproject.com/kb/launch-parameters)，本轮计划用现有程序的临时副本隔离配置，不加载用户原场景。仅复制了已安装 OBS 的 `bin`、`data`、`obs-plugins` 到下列新目录，并写入空的 `portable_mode.txt`，没有下载、安装或卸载软件：

```text
C:\Users\ASUS\AppData\Local\Temp\WindChime-OBS-20260911-audit
C:\Users\ASUS\AppData\Local\Temp\WindChime-OBS-20260911-audit\portable_mode.txt
C:\Users\ASUS\AppData\Local\Temp\WindChime-OBS-20260911-audit\bin\64bit\obs64.exe
```

读取 computer-use 技能后，实际调用为：

```javascript
await sky.launch_app({
  app: 'C:\\Users\\ASUS\\AppData\\Local\\Temp\\WindChime-OBS-20260911-audit\\bin\\64bit\\obs64.exe'
});
```

调用后的进程核对却返回 **PID 37896**，可执行文件为原安装路径 `C:\Program Files\obs-studio\bin\64bit\obs64.exe`，窗口标题为 `OBS 32.0.1 - 配置文件: Untitled - 场景: Untitled`。临时目录没有出现预期的 `config`。因此该次启动不能算隔离便携实例启动成功，不能作为采集验收。

随后只读文件元数据观察到：

- `C:\Users\ASUS\AppData\Roaming\obs-studio\user.ini` 的修改时间为 **2026-09-11 00:26:44**，对应这次启动；不能声称原 OBS 配置完全未被写入。
- 同目录 `global.ini` 的修改时间仍为 **2026-06-11 21:28:02**；`basic\scenes` 目录修改时间仍为 **2026-06-11 21:28:01**。
- 没有读取配置内容或对比前后字节，不能据这些时间戳推断 `user.ini` 具体变化。

没有对 OBS 执行点击、添加/修改场景、录制或推流，也没有添加测试展示源。发现启动路径偏差后，准备重新确认窗口时，用户按了实体 **Escape**；Computer Use 工具明确报告操作被用户停止。此后不再调用 Computer Use 或任何替代工具操作、关闭 OBS；用户自行处理窗口。临时副本仍保留，没有清理。

直播姬的窗口枚举只返回一个无标题的透明 pane，没有得到可确认的采集工作台。该次窗口截屏显示了被遮挡的其他应用内容，已排除为有效采集证据；没有操作登录、场景、来源或推流。

## 用户重新授权后的隔离启动：通过；窗口交互：失败

上述 Escape 停止后，用户明确表示「你可以重新操控了」，本轮据此恢复一次独立检查。采用系统进程 API 精确指定已有临时副本，没有再次使用会选择错误程序的 `sky.launch_app`，也没有修改或关闭原 OBS 实例。

先以隐藏模式启动验证路径，进程 PID 64244 的可执行路径及命令行均匹配临时副本，且临时 `config\obs-studio` 已生成。为了进行用户已授权的可见交互，核对该 PID 的完整路径后仅停止这个新建的隐藏测试进程，再以正常窗口启动同一副本：

```powershell
$obsPortableExe = 'C:\Users\ASUS\AppData\Local\Temp\WindChime-OBS-20260911-audit\bin\64bit\obs64.exe'
Start-Process -FilePath $obsPortableExe `
  -ArgumentList @('--portable','--multi','--disable-updater','--only-bundled-plugins') `
  -WorkingDirectory (Split-Path -Parent $obsPortableExe) `
  -WindowStyle Normal -PassThru
```

后续证据：

- 正常窗口测试进程 PID **37852**，与原安装 OBS 的 PID 37896 分离。
- Computer Use 返回的窗口所属路径为 `process:C:\Users\ASUS\AppData\Local\Temp\WindChime-OBS-20260911-audit\bin\64bit\obs64.exe`，窗口 ID 151785476。
- 窗口标题明确为 `OBS 32.0.1 - Portable Mode - Profile: Untitled - Scenes: Untitled`。
- 临时目录生成独立 `config\obs-studio\global.ini`、`user.ini`、`basic\scenes\Untitled.json` 和 `basic\profiles\Untitled\basic.ini`；读取的是这个空白测试场景，没有加载用户旧场景。
- 可访问性树显示空白 `Scene`、空来源列表，按钮为 `Start Streaming`、`Start Recording`，两项计时均为 `00:00:00`。

但是窗口截图显示的是被其他应用遮挡的内容，不是有效的 OBS 预览证据。对这个已确认窗口调用 `sky.activate_window` 返回：

```text
failed to activate captured window
```

按 computer-use 技能重新枚举、获取正确窗口并只重试一次，仍返回相同错误，因此停止原生交互，没有使用替代输入工具绕过。尚未创建 OBS 专用合成话题/授权、浏览器来源或棋盘背景，没有开播、录制或虚拟摄像头输出。

此次可确认的是 **准确路径的隔离便携实例能够启动并使用临时配置**；仍无法确认实际浏览器源显示与透明采集。原安装 OBS、便携 OBS 窗口和临时文件均保留，没有继续关闭或清理；用户可自行处理这些窗口。直播姬也没有进一步操作。

## OBS 内置 API 实际采集：10/10 通过

窗口焦点问题不影响 OBS 正式控制接口，因此后续采用官方 [obs-websocket 协议](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md) 完成本地采集。只配置临时便携目录的插件文件，保持 `auth_required=true`，生成本轮随机 256-bit 口令，使用测试端口 44569；没有读取或修改原安装 OBS 的 WebSocket 配置。口令没有写入仓库、脚本、命令行或报告。

实际 API 测试实例为 **PID 21936**，其完整程序路径再次核对为临时副本。obs-websocket 的官方实现支持端口及 IPv4 配置，实际监听 IPv4 `0.0.0.0:44569`；测试客户端只连接 `127.0.0.1`，没有更改防火墙。测试结束后已精确停止这个便携进程，并将临时 `server_enabled` 改回 `false`；最终只读检查进程不存在、44569 监听数为 **0**。原安装 OBS PID 37896 未被操作。

可运行验收脚本为 `apps/live-gateway/scripts/test-obs-capture.mjs`。脚本只接受 localhost 站点，要求显式允许临时写入和 `portable_mode.txt`；使用已准备好的便携实例及其受认证 API，不自行启用推流、录制、虚拟摄像头或回放缓存。实际命令形态为：

```powershell
Set-Location -LiteralPath 'C:\Users\ASUS\Documents\ChatGPT\风铃\WindChime\apps\live-gateway'
$env:WINDCHIME_SMOKE_ALLOW_WRITES='1'
$env:WINDCHIME_SMOKE_PASSWORD='隔离测试网站的口令'
$env:WINDCHIME_SMOKE_URL='http://localhost:3011'
$env:WINDCHIME_OBS_PORTABLE_DIRECTORY='C:\Users\ASUS\AppData\Local\Temp\WindChime-OBS-20260911-audit'
$env:WINDCHIME_OBS_OUTPUT='C:\Users\ASUS\Documents\ChatGPT\风铃\.work\obs-capture'
node scripts/test-obs-capture.mjs
```

本次连接 UliUli 的隔离 SQLite 生产测试进程，创建独立合成话题及信件，原文与展示稿使用不同文字。上传一张合成 PNG，经风铃规范化后加入审核稿。通过 `CreateScene`、`CreateInput` 在便携 OBS 新建棋盘图片源与上层 `browser_source`，后者使用独立网关 `/display` 和该话题只读令牌。使用 `GetSourceScreenshot` 获取浏览器源与合成场景的真实 PNG，并以 `sharp` 统计 alpha，最后人工核对合成图片。

第一次 API 尝试在隐藏预览尚未产生场景帧时没有等到接收端，未计为通过；脚本改为先请求初始场景截图，使未推流的本地渲染实际开始，再检查接收端。随后完整流程 **10/10 通过**：

| 检查 | 实际结果 |
| --- | --- |
| 运行版本 | OBS **32.0.1**；obs-websocket **5.6.3**；实际 `browser_source` 来自便携副本 |
| 初始未审核 | 1280×720，共 921600 个像素全部 alpha=0 |
| 批准但不上屏 | 仍是 921600 个透明像素 |
| 手动上屏 | 出现审核后的昵称、正文及规范化图片；28805 个非透明像素、892795 个透明像素 |
| 合成透明效果 | 上层空白区域露出底层两种棋盘灰度；采样 RGBA 分别为 `(24,24,24,255)`、`(42,42,42,255)` |
| 一键隐藏 | 浏览器源重新全部透明；本次从服务响应到取得空白 PNG 为 **924 ms**，从发起控制调用起为 **943 ms**，包含 WebSocket 截图与轮询开销，属于一次观察，不是所有设备的延迟保证 |
| 撤销正在展示的批准 | 浏览器源重新全部透明 |
| 输出状态 | 开始与结束时推流、录制、虚拟摄像头均未激活；脚本也禁止这些启动类请求 |
| 临时数据清理 | 本轮只读令牌已撤销，合成话题及信件已清理；报告 `fixturePurged=true` |

本机证据文件保留在：

```text
C:\Users\ASUS\Documents\ChatGPT\风铃\.work\obs-capture\report.json
C:\Users\ASUS\Documents\ChatGPT\风铃\.work\obs-capture\03-manual-show-source.png
C:\Users\ASUS\Documents\ChatGPT\风铃\.work\obs-capture\04-manual-show-composite.png
C:\Users\ASUS\Documents\ChatGPT\风铃\.work\obs-capture\05-hidden-source.png
C:\Users\ASUS\Documents\ChatGPT\风铃\.work\obs-capture\06-hidden-checkerboard.png
C:\Users\ASUS\Documents\ChatGPT\风铃\.work\obs-capture\07-revoked-source.png
```

已目视确认 `04-manual-show-composite.png` 只有审核稿和图片，`06-hidden-checkerboard.png` 只剩棋盘，没有私人控制台、登录界面、原始未审核正文或错误提示。这是 OBS 浏览器源的真实合成结果，不是原生窗口截屏的遮挡内容。

## 最终验收边界

**OBS 浏览器源的实际合成、透明显示及隐藏/撤销已通过上述本地验收。** 这不覆盖 OBS 对 Electron 窗口的捕获方式、真实睡眠恢复或所有显示驱动，也不代表直播姬普通采集、H5 容器启动与平台生命周期已经验证。直播姬只有安装路径/版本及无法确认工作台的窗口检查，没有实际来源采集证据。

本轮新增通过证据包括最新网关构建、14 项网关测试、1 项真实签名契约集成、用户重启后的网关进程复核，以及 OBS 正式 API 驱动的 10 项采集检查。首次启动路径偏差和 Escape 停止、后续焦点失败都保留为历史记录；最终使用官方 API 完成可独立执行的采集验证。真实 B 站项目配置、API/容器联调和平台审核仍按 [BILIBILI-LIVE.md](BILIBILI-LIVE.md) 分别记录。
