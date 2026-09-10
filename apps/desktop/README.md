# 风铃桌面控制台（Windows x64）

主播在私人控制台审信，OBS 或直播姬只捕获 **WindChime Display** 窗口。程序直接连接兼容的风铃网站，不需要 B 站项目、密钥、主播身份码或接入网关。

信件、图片、审核、待播顺序和样式仍由网站服务器保存。这里的“本地桌面版”指本地运行客户端；连接网站和同步信箱需要联网。

## 安装和运行

下载 `out/installers/WindChime-Setup.exe` 安装，或解压 `WindChime-win32-x64-0.6.0.zip` 后运行 `WindChime.exe`。文件摘要见同目录 `SHA256SUMS.txt`。首版没有 Windows 代码签名或自动更新。

从源码运行：先在 WindChime 仓库根目录执行 `npm ci`，再执行：

```powershell
cd apps/desktop
npm ci
npm run dev
```

`npm run build` 构建界面及图标；`npm run make` 生成 Windows x64 安装包、ZIP、RELEASES 与 nupkg。构建使用 Electron Forge，Squirrel 的中间输出放在英文临时目录；若临时目录含非 ASCII 字符，可设置 `WINDCHIME_BUILD_ROOT=C:\WindChimeBuild`。

图标源是 `assets/branding/windchime-logo-v1-master.png`；构建自动导出 16–256 像素 ICO、界面 PNG 与托盘 PNG，复用同一 Logo。

## 连接信箱与展示

1. 网站升级到风铃 0.6.0，提供 `/api/mail/live` 和私人工作台 `/mail/live`。
2. 桌面端填写网站首页地址与连接名称，点击“在浏览器中登录并授权”。在网站核对配对码、选择话题并批准设备。程序不保存网站密码。
3. 私下查看原文，编辑最终展示稿；保存后明确批准。批准只加入待播列表，画面保持空白。
4. 点击“打开独立展示窗口”。直播软件添加窗口捕获，选择 **WindChime Display**。不要采集私人控制台或整个桌面。
5. 点击“上屏”或“下一封”才展示。最后一封后再次点下一封会清空，不循环。
6. “一键隐藏”、托盘菜单或 **Ctrl+Shift+H** 撤下画面。关闭私人窗口会留在托盘，托盘“退出并结束展示”才结束程序。

OBS 32.0.1 已用真实窗口捕获验证：捕获方式选择 Windows Graphics Capture，窗口标题选择必须匹配，开启“强制 SDR”，关闭捕获光标与音频；将来源完整适配到场景画布。这里对应 `method=2`、`priority=1`、`force_sdr=true`。在本机不强制 SDR 会出现颜色偏暗，按 exe 回退匹配则可能在展示窗口关闭后捕获私人控制台。

请在正式使用前检查直播软件的本地预览。直播姬须单独验证，不能把 OBS 或 Electron 截图透明当作其他采集方式已通过的证明。完整截图、命令与限制见验收记录。

可以保存多个站点和话题连接。切换连接、新配对成功时先清空并关闭旧输出。有效批准、完整排序、已读和收藏保留；上屏不自动修改已读状态。

网页与桌面共用业务规则。修改正文、称呼、图片、图片说明或顺序会使旧批准失效，正在展示的信同步撤下。并发编辑明确提示冲突，保留未保存草稿。支持静态图片上传、透明背景、字体、字号、颜色、布局、图片排列和动画。

桌面每 500 ms 查询展示状态；共享库默认展示组件仍为 1000 ms，可通过 `pollIntervalMs` 在 250–1000 ms 内配置。正常网络下，远端隐藏还包含轮询与采集刷新时间；本机紧急隐藏不等待网站响应。

## 权限与旧版本升级

- 展示端只持有网站签发的只读授权，仅能取得当前获准播出的快照及图片。独立窗口没有管理 IPC、网站登录页或通知组件。
- 设备凭据通过 Electron `safeStorage` 使用 Windows 系统加密，保存为 `devices.v1.enc`。旧版本 v1 配对仍可读取，旧 `gatewayOrigin` 和 `bindingId` 字段被忽略。
- 首次打开、重载、程序重启、恢复休眠或连接不确定时回到空白，直到新的手动上屏。没有待机时自动补播的任务。
- 桌面发行不处理 B 站启动参数，不连接平台会话，也不签发浏览器源链接。共享库仍可供其他网站配置独立展示页；网关与 H5 源码保留为另行启用的可选模块。
- 运行包采用文件白名单，不含 `.env`、平台密钥、测试数据或签名证书。

卸载可使用 Windows 的已安装应用入口。设备授权存储与程序文件分离；可在网站设备管理中撤销授权。本轮安装/托盘卸载是否完成，以实际验证报告为准，不把构建成功视为卸载已通过。

## 验证

```powershell
npm test
npm run test:smoke
```

真实两站联调先启动独立验收站点，再运行：

```powershell
$env:WINDCHIME_SMOKE_ALLOW_WRITES='1'
$env:WINDCHIME_SMOKE_PASSWORD='隔离测试站点密码'
$env:WINDCHIME_SMOKE_ULIULI_ORIGIN='http://localhost:3021'
$env:WINDCHIME_SMOKE_MIA_ORIGIN='http://localhost:3022'
npm run test:sites
```

脚本生成四个话题和临时加密配置，需要通过真实网站页面批准四次配对；重启阶段使用另一个 Electron 进程。禁止把测试脚本用于生产信箱。

实际 OBS 窗口采集脚本为 `scripts/capture-window.cjs`，需已有受密码保护的独立便携 OBS 实例；它使用真实网站的合成话题和桌面主程序，通过 OBS 正式 API 选择展示窗口并验证采集。脚本禁止启动推流、录制、虚拟摄像头或回放缓存。

最新结果、失败原因、安装包与采集边界见 [VALIDATION.md](./VALIDATION.md) 和 [独立桌面版验收](../../docs/DESKTOP-LOCAL-VALIDATION.md)。此前平台模拟和 OBS 浏览器源结果仅为历史，不代替本轮窗口捕获验收。
