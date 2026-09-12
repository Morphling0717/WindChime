# 风铃 0.6.1 直播审核、展示与桌面运行指南

当前交付采用 **本地 Windows 桌面程序直接连接风铃站点，直播姬或 OBS 采集独立展示窗口**。启动桌面程序不经过 B 站官方入口，不需要平台密钥、项目 ID、H5 发布或上架审核。网关和 H5 代码保留为可选模块，已有平台项目与私有配置无需改动。

0.6.1 默认在网页生成有效期 30 天、可重复导入的桌面连接密钥，旧浏览器配对作为备用。完整生成、导入、多台共用与撤销步骤见 [CONNECTION-KEYS.md](CONNECTION-KEYS.md)。网站必须实际部署 0.6.1 才能支持新密钥流程；本轮不进行生产部署。0.6.1 的实际验收单独见 [KEYS-VALIDATION.md](KEYS-VALIDATION.md)。

0.6.0 把「审核批准」和「上屏」分成两个服务端操作。网页后台、桌面控制端和直播展示共用 `service.broadcast`；未审核原文只进入私人控制台。审核生成固定版本的正文、昵称、链接文字和图片快照，展示接口只返回当前被手动选中的获准快照。

这里的「本地」指桌面程序和展示窗口运行在主播电脑上。它们仍通过网络连接所选站点，由站点保存信件、执行审核与授权；网页后台与桌面操作结果同步，不维护另一套离线信箱。

本指南覆盖运行与部署顺序。精确请求字段见 [LIVE-CONTRACT.md](LIVE-CONTRACT.md)，旧数据升级见 [MIGRATION.md](MIGRATION.md)，可选官方接入见 [BILIBILI-LIVE.md](BILIBILI-LIVE.md)。实际测试结果见 [LIVE-VALIDATION.md](LIVE-VALIDATION.md) 及其中链接的报告，按各自执行日期与范围理解；[既有网关与采集记录](LIVE-CAPTURE-VALIDATION.md) 是历史证据，不表示本轮桌面安装或窗口捕获已经验收。

## 交付入口与实施顺序

| 部分 | 代码/入口 | 职责 |
| --- | --- | --- |
| 独立通用库 | `@windchime/embed@0.6.1`，`core`、`server`、`sqlite`、`next`、`client`、可选 `broadcast` 子入口 | 审核、队列、版本、隔离授权、图片快照、断线安全规则 |
| UliUli / Mia | 两站 `/mail/live`；原 `/mail` 保留 | 私人审信、修改展示稿、批准/拒绝、排序、预览、上屏和外观 |
| 桌面控制端 | `apps/desktop`；在原站点 `/mail/live` 生成连接密钥 | 直接连接站点、共用审信工作台、多站点/话题切换、快捷隐藏 |
| 桌面独立展示 | **WindChime Display** 窗口 | 直播软件采集此窗口；只读获取当前获准画面，不含登录或管理界面 |
| 无 B 站完整示例 | `examples/next-sqlite` 的 `/admin/live`、独立 `/display` | 其他 Next.js 网站的可运行接入范例 |

先备份并升级站点到同一 0.6.1 包，在原网站生成连接密钥并导入桌面，最后打开独立窗口进行本地采集验收。平台配置不参与这个顺序。网关 `/display` 浏览器源、`/h5` 官方启动和站点 `/mail/connect` 平台绑定属于后文的可选模块。

## 本地启动

下面示例使用 Windows PowerShell；当前工作区绝对路径为 `C:\Users\ASUS\Documents\ChatGPT\风铃\WindChime`。其他机器替换这个路径即可。通用库要求 Node.js 20.19+；各宿主和桌面开发环境继续按自己的 `engines` 安装。最终桌面发行包自带 Electron 运行时，主播无需额外安装 Node.js。

先安装并构建通用库：

```powershell
Set-Location -LiteralPath 'C:\Users\ASUS\Documents\ChatGPT\风铃\WindChime'
npm ci
npm run build
```

**两个现有站点**固定到各自 `vendor/windchime-embed-0.6.1.tgz`。在每站运行 `npm ci`，保留既有 `.env.local`、数据库路径、登录配置和身份盐，再增加以下配置。例如 UliUli 本地端口选用 3401：

```dotenv
WINDCHIME_SITE_ORIGIN=http://localhost:3401
WINDCHIME_MEDIA_DIRECTORY=./data/mail-media
```

Mia 如运行在 3402，则把本站 `WINDCHIME_SITE_ORIGIN` 改为 `http://localhost:3402`。上述端口是可替换的本地示例；浏览器地址、本站 origin 和实际端口须一致。桌面直接连接站点，不需要配置网关来源、公钥或网关展示 URL；已有可选浏览器展示配置可以保留。

```powershell
# UliUli：先在数据库副本完成下文迁移演练。
Set-Location -LiteralPath 'C:\Users\ASUS\Documents\ChatGPT\风铃\Next_UliUli'
npm ci
npx next dev --webpack --hostname 127.0.0.1 --port 3401
```

```powershell
# Mia：另开终端。
Set-Location -LiteralPath 'C:\Users\ASUS\Documents\ChatGPT\风铃\Next_Mia'
npm ci
npx next dev --webpack --hostname 127.0.0.1 --port 3402
```

打开对应站点 `/mail/live`，沿用该站原有管理员登录。生产构建用 `npm run build -- --webpack`，启动用 `npm start -- --hostname 127.0.0.1 --port <实际端口>`，前面配置 HTTPS 反向代理；不要在两个进程里同时运行同一站点数据库的直播服务。

**从空数据库体验通用示例**无需两个主播的任何凭据：

```powershell
Set-Location -LiteralPath 'C:\Users\ASUS\Documents\ChatGPT\风铃\WindChime\examples\next-sqlite'
npm ci --install-links
npm run setup
npm run db:init
npm run dev
```

默认地址 `http://localhost:3010`；`setup` 首次创建随机管理员密码与稳定盐，再次执行不覆盖旧配置。通过 `/admin` 登录后进入 `/admin/live`。本例的独立 `/display` 使用单独页面布局，不依赖网关或 B 站。示例完整部署方式见 [示例 README](../examples/next-sqlite/README.md)。

## 主播使用与桌面打包

1. 粉丝仍从原投稿网页寄信。所有新旧信件都需要单独的广播批准；已读、收藏和敏感词状态没有上屏权限。
2. 在私人工作台查看原文和最终展示稿。可修改文字、昵称、链接文字，上传替换图片并调整顺序和说明。先保存，再明确批准；批准后进入有序待播列表，画面保持空白。
3. 打开桌面独立展示窗口，等待接收端在线。点击指定信件「上屏」；「下一封」按批准列表顺序推进，没有下一封时不会循环播放旧信。
4. 已经展示过的获准信件仍留在列表，可排序和再次手动上屏。「一键隐藏」立即撤下当前画面；「结束展示」重置播放状态；撤销批准或拒绝正在展示的信件也会撤下。
5. 修改任何展示内容会作废原批准，需要重新审核。服务端拒绝过期版本的保存/批准；工作台保留未保存稿件并要求明确处理版本冲突。

在直播姬或 OBS 添加窗口捕获源，明确选择标题为 **WindChime Display** 的独立窗口。工作台中的预览、原文、登录页和错误说明属于私人界面，不应作为采集源。首次连接、断线恢复、授权失效、程序重启和睡眠恢复保持空白，在线后仍需新的手动上屏。展示组件支持透明背景；实际窗口捕获是否保留透明，取决于所用采集程序及捕获模式，应在不开播的预览中确认。

桌面开发运行与 Windows x64 打包：

```powershell
Set-Location -LiteralPath 'C:\Users\ASUS\Documents\ChatGPT\风铃\WindChime\apps\desktop'
npm ci
npm start
# 结束开发程序后，需要制作发行包时运行：
npm run make
```

在原网站登录、选择话题并生成桌面连接密钥，复制到桌面导入。密钥有效 30 天，可重复使用；共用同一密钥的电脑会在撤销后一起失效，详细说明见 [CONNECTION-KEYS.md](CONNECTION-KEYS.md)。原浏览器配对保留为备用入口。桌面不要求输入网站管理员密码，控制授权限制到一个站点/话题。支持多个连接，切换连接清空输出。**Ctrl+Shift+H** 和托盘菜单均可一键隐藏；关闭控制台窗口保留托盘，使用「退出并结束展示」结束程序。这里使用风铃设备授权，不使用 B 站身份码或平台登录。

`make` 的目标产物位于 `apps/desktop/out/installers/`：`WindChime-Setup.exe` 和 `WindChime-win32-x64-0.6.1.zip`，另有 Squirrel 更新文件。ZIP 解压后运行 `WindChime.exe`。默认未做 Windows 代码签名；签名证书可通过构建环境单独配置。具体 ASCII 暂存目录、签名变量、设备凭据和测试命令见 [桌面 README](../apps/desktop/README.md)。是否已生成、安装及实机验证应以本轮验证记录为准，不能仅因有 `make` 命令就视为安装验收通过。

默认外观支持透明背景、字体、字号、文字/背景颜色、圆角、间距、布局、图片排列和动画。开发者可从 `@windchime/embed/broadcast` 导入 `WindChimeLiveDisplay`，提供稳定的只读 `client` 和自定义 `render({snapshot, appearance, assetUrls})`；只有服务端批准的快照及固定图片能进入该组件。`@windchime/embed/client` 提供 `createWindChimeDisplayClient`。自定义页面应继续使用接收器的连接、清屏和图片校验规则，并保持独立文档/窗口；库的其他子入口仍能在无 B 站、无桌面的 Next.js 网站中独立使用。

## 站点生产配置与可选展示模块

桌面可以直接连接已部署的 HTTPS 站点，无需在主播电脑运行风铃服务端。网站数据库及私有图片目录使用持久存储并一起备份，沿用既有登录和稳定身份盐。本版每个站点的直播服务采用单进程会话协调，不要直接扩展为没有共享会话协调的多实例或 serverless 服务。

如果另外需要浏览器源，可以使用 `examples/next-sqlite` 的独立 `/display`，或按下面命令启动 `apps/live-gateway` 的普通 `/display`。这不是桌面运行的前置步骤，普通浏览器展示也不需要 B 站密钥。网关要求 Node.js 22+：

```powershell
Set-Location -LiteralPath 'C:\Users\ASUS\Documents\ChatGPT\风铃\WindChime\apps\live-gateway'
npm ci
npm run build
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
npm start
```

默认网关为 `http://localhost:3390`，监听 `127.0.0.1`，健康检查为 `/healthz`。修改共享展示组件后重新构建；修改服务端或配置后重启此服务。使用跨站浏览器展示时，在目标站点配置：

```dotenv
WINDCHIME_LIVE_ORIGINS=http://localhost:3390
NEXT_PUBLIC_WINDCHIME_DISPLAY_URL=http://localhost:3390/display
```

来源与实际地址必须一致；生产使用 HTTPS。`NEXT_PUBLIC_WINDCHIME_DISPLAY_URL` 是构建时配置，改值后重新构建站点。普通展示只读授权放在 URL fragment，刷新保留连接所需的令牌，不保存当前信件；每次重新连接后仍需新的手动上屏。不要公开分享展示凭据。

网关的 `/h5`、平台配对与生命周期 API 保留供将来明确选择官方接入时使用，详见 [BILIBILI-LIVE.md](BILIBILI-LIVE.md)。这些模块使用服务端平台密钥及单独的绑定、签名和平台租约。当前桌面流程不调用这些 API，不使用 `code=` 官方启动，也不要求创建、修改或删除任何 B 站项目。官方启动、真实平台联调和审核上架均不属于当前交付范围；旧报告中的平台缺口不阻塞本地桌面和窗口采集。

## 升级、接口与验证

先停止旧进程写入，用两站已有 `db:backup` 进行包含 WAL 状态的完整备份，在副本迁移。备份 CLI 不自动读取 Next.js 的 `.env.local`，必须显式指定数据库路径。例如在对应站点目录中：

```powershell
$env:DATABASE_PATH='D:\site-data\实际需要备份的数据库.db'
npm run db:backup
# 先准备独立演练副本，再将路径改为该副本；不要对唯一原库演练。
$env:DATABASE_PATH='D:\windchime-rehearsal\site-copy.db'
npm run db:migrate
```

新增 `mail_live_*` 表和触发器不清空旧信件、话题、已读、收藏或敏感词状态；历史信件广播批准为空。图片要求宿主安装 `sharp` 并提供非公开持久目录。规范化静态图片以摘要固定，展示不热链图片、不嵌入外部网页，投稿链接按批准文本显示。数据库与图片应一起备份。检查完整性、旧 ID/数量和原后台功能后再按部署流程升级真实库。本次没有执行生产迁移。现有身份盐不得在升级时自动轮换。

两站已携带同一 0.6.0 tar 包及锁文件。后续修改通用库后，生产发布应重新 `npm pack`，更新两站 `vendor` 包与锁文件并构建；本地持续开发可在库根执行 `npm run dev:sync`，把构建同步到已安装的两个消费者。不要分别复制修改两份审核逻辑。

| API 分组（站点前缀 `/api/mail/live`） | 权限与行为 |
| --- | --- |
| `GET /capabilities` | 协议版本、站点 ID 和支持功能，不含信件 |
| `/control/state`、`/control/action`、`/control/message` | 原站点管理员或单话题设备控制授权；审信及原有已读/收藏 |
| `/control/grants`、`/devices/*` | 创建/撤销只读展示授权、浏览器批准设备、PKCE 兑换 |
| `/display/open`、`/display/frame`、`/display/assets/*` | 只读展示专用授权，只返回当前获准快照及其图片；打开新接收端为空白 |
| 可选 `/control/binding-challenge`、`/control/bind` | 官方接入时由站点私下批准平台话题绑定；默认桌面不使用 |
| 可选 `/gateway/exchange`、`/gateway/renew` | 官方接入时验证受信网关证明；只产生/延长展示凭据 |

验证命令按所在目录执行：

```powershell
# WindChime 根：核心规则、展示接收器和 UI 契约。
npm test
npm run typecheck
npm run pack:check

# apps/desktop：原生边界和真实 Electron 窗口，后者使用隔离 fixture。
npm test
npm run test:smoke

# 各宿主：保留原信件/话题功能、迁移回归和完整构建。
npm run test:mail
npm run test:mail:migrations
npm run build -- --webpack
```

验收应覆盖未审核不输出、批准不播放、手动上屏/下一封/隐藏、撤销当前批准、改稿重新审核、断线/刷新/重启空白和跨站点/话题拒绝。桌面安装、真实 Electron 窗口及直播软件窗口采集分别记录结果，浏览器源测试不能替代窗口捕获测试。上面的命令仅说明如何执行，不表示本轮已经通过。

维护可选网关时，在先构建根库后于 `apps/live-gateway` 执行 `npm run check`、`npm test`、`npm run test:integration`。这些测试使用隔离数据和受控平台响应，不调用真实 B 站密钥；此前的平台测试与采集记录保留其原有日期和范围，不用作本轮新增验收结论。
