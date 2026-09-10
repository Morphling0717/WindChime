# 可选 B 站官方接入与独立网关

当前交付采用本地 Windows 桌面程序直接连接风铃站点，直播姬或 OBS 采集 **WindChime Display** 独立窗口。这个流程不使用 B 站官方启动、H5 或平台生命周期 API，不需要配置平台密钥、项目 ID 或提交上架审核。网站仍联网保存信件并执行共用审核规则，桌面不维护离线收件箱。默认运行方法见 [LIVE.md](LIVE.md) 和 [桌面 README](../apps/desktop/README.md)。

本文记录保留在 `apps/live-gateway` 的可选模块：普通透明浏览器展示、H5 平台入口、平台生命周期和配对 API。已有平台项目与私有配置保持原状；下列平台配置仅供将来明确启用官方接入时使用，不是当前桌面交付的条件。历史验证报告仍按其原日期与范围解释，本次文档调整不代表重新测试这些模块。

## 架构与权限

`apps/live-gateway` 独立部署；风铃通用库、每个接入站点和桌面应用无需携带 B 站平台密钥。网关只保存站点/话题绑定、一次性配对、已用启动签名摘要和自身 Ed25519 签名密钥。它不会连接站点服务器抓取数据，不会转发或保存投稿正文，不持有站点管理凭证。

默认桌面由控制端和只读展示窗口直接连接原站点，不经过网关。只有启用可选 H5 模块时，展示网络路径才是：

```text
B 站容器 → 网关 /h5 → 网关同源 /display
                            ↓ 浏览器直连，只读 Bearer + 平台租约
                  自托管站点 /api/mail/live/display/*

私下审核：网页控制台或桌面端 → 原站点 /api/mail/live/control/*
```

每个话题独立绑定。站点数据库中的管理员批准记录是最终授权依据；网关里伪造站点元数据不能建立目标站点的权限。`plug_env` 只决定设置外层或展示外层，不能赋予管理员身份。设置外层仅展示通用配置说明，审信和确认绑定必须回原站点完成；设置弹窗不调用平台 start，也不消费实际展示可能复用的同秒启动签名。

独立 `/display` 没有 Next.js 根布局、登录页、通知、PWA 或收件箱客户端。普通展示地址仅从 fragment 读取 `siteBaseUrl` 和只读 `token`，保留这些重新连接所需的片段参数；它们不会随 HTTP 请求发送给服务器，全部数据请求使用 `credentials: omit`。H5 模式会清除已经消费的一次性 proof，保留连接目的地及父窗口桥标识，刷新后向仍有效的父窗口取得新 proof。首次打开、重新打开、刷新和恢复连接都创建新的空白接收端，必须再次手动上屏；不保存任何信件或当前画面缓存。

## 可选网关本地运行

普通浏览器源和平台 H5 共用此服务；桌面窗口无需运行它。要求 Node.js 22 或更新版本。以下命令从 WindChime 仓库根目录执行，已有 `.env` 不要覆盖：

```powershell
Set-Location -LiteralPath 'C:\Users\ASUS\Documents\ChatGPT\风铃\WindChime\apps\live-gateway'
npm ci
npm run build
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
npm start
```

替换为实际仓库路径。默认地址为 `http://localhost:3390`，默认监听 `HOST=127.0.0.1`；通过 `PORT` 和 `GATEWAY_ORIGIN` 改端口。`npm start` 明确加载本目录可选 `.env`，直接导入服务模块不会读取配置文件或启动监听。`npm run build` 将通用库中的 `WindChimeLiveDisplay` 编译成独立展示脚本。

站点配置展示地址为 `<gatewayOrigin>/display`。普通展示链接格式：

```text
https://gateway.example/display#siteBaseUrl=https%3A%2F%2Fsite.example%2Fapi%2Fmail%2Flive&token=wc_disp_...
```

展示令牌仍是授权凭证，不要公开分享。它不能读取完整收件箱、列出待播队列或执行管理操作；主播可在站点控制台撤销。

普通浏览器展示仅需目标站点允许其 CORS 来源，并配置展示 URL；它不需要 B 站密钥或平台公钥。只有平台绑定/证明兑换才需要维护者访问 `/.well-known/windchime-gateway.json` 取得 `issuer` 和 `publicKeys`（JWT `kid` → Ed25519 公钥 PEM），明确配置到各站点的 `gatewayIssuer`、`gatewayPublicKeys`。不要根据外部请求提供的 URL 自动信任新公钥。

## 生产部署和持久化

```sh
cd apps/live-gateway
# 在 .env 中设置实际 HTTPS 的 GATEWAY_ORIGIN 及服务端平台配置。
docker compose up -d --build
```

Compose 仅向宿主机回环地址开放 `3390`，由已有 HTTPS 反向代理转发。设置 `GATEWAY_ORIGIN=https://实际网关域名`。不要在反向代理记录 H5 启动 URL 的查询参数、Authorization 请求头或请求体；平台会把主播身份码放在启动参数内。网关自身不记录这些值，并返回 `Referrer-Policy: no-referrer`、`Cache-Control: no-store`。

持久卷 `/data` 包含：

- `gateway-signing-key.pem`：首次启动生成、仅服务端使用的 Ed25519 私钥。
- `gateway-state.json`：话题绑定、配对记录、重放阻止摘要；不含信件正文、B 站身份码或活动平台会话。

备份此卷并限制服务器文件访问权限。持久化数据无法读取时服务拒绝静默重置。恢复同一卷可保留绑定和公钥；活动会话故意不恢复。丢失/主动轮换网关私钥后，要在所有站点更新受信公钥并重新连接展示。此实现使用单进程、单实例部署，不应让多个实例并发写同一个 JSON 卷。

Dockerfile 的专用忽略文件排除 `.env`、运行数据和 `node_modules`，密钥只通过运行时环境注入，不作为镜像构建参数。运行镜像仅包含网关服务和构建后的展示资源，以非 root 用户运行。

## 可选官方接入的配置与边界

官方文档区分直播创作者服务中心与通用开放平台，两者需要单独接入和申请开发者权限。因此已经取得某套开放平台密钥，不代表已有直播姬插件权限。[快速开始](https://open-live.bilibili.com/document/849b924b-b421-8586-3e5e-765a72ec3840)

保留的 H5 适配对应官方 HTTPS iframe 场景；网关同时保留面向官方桌面启动的独立 channel API。官方桌面方案涉及 `code=...` 启动参数和相应项目配置，不能把 H5 的项目 ID 自动当作桌面项目 ID。**当前默认桌面流程不使用这些启动参数或 API**，不以正式商店接入为目标。猫猫养成详情页仅作为原先使用体验的参考，不用于推测其内部架构。[H5 文档](https://open-live.bilibili.com/document/ad4901b8-c13e-7a20-e07e-410ad182564a)、[桌面启动说明](https://open-live.bilibili.com/document/5dffc297-6fd2-41ff-bd45-6e8b89e2a68e)、[猫猫养成详情](https://play-live.bilibili.com/details/1716707754657?from=1)

若将来启用官方接入，仅在网关 `.env` 配置下列字段。本地窗口采集无需填写它们：

保留下面的变量名，只填写等号右侧。若平台显示 `access_key_id: 值`、`access_key_secret: 值`，分别把“值”填入 `BILIBILI_ACCESS_KEY_ID=` 和 `BILIBILI_ACCESS_KEY_SECRET=`，不要直接复制冒号格式，也不要把密钥保存在 `.env.example`。运行时读取的是 `.env`；该文件已被 Git 和 Docker 构建排除。

| 配置 | 用途 |
| --- | --- |
| `BILIBILI_ACCESS_KEY_ID` | 直播创作者服务中心的服务端 API 标识 |
| `BILIBILI_ACCESS_KEY_SECRET` | 服务端 API HMAC 签名 |
| `BILIBILI_H5_SIGN_SECRET` | 商店 H5 启动 CodeSign 验签；明确核对平台配置，不自动猜测密钥对应关系 |
| `BILIBILI_H5_APP_ID` | H5 项目 ID，十进制 int64 字符串 |
| `BILIBILI_DESKTOP_APP_ID` | 桌面直播工具项目 ID，独立配置 |

H5 启动验签使用哪个平台配置必须单独核实；当前记录不确认 `BILIBILI_H5_SIGN_SECRET` 等于邮件中的 API secret，本模块也不会自动作此映射。未核实的字段保持空白，不影响默认本地桌面流程。

密钥不进入站点源码、公开网页、桌面安装包、展示 JWT 或 Docker 镜像。网关只把开发者 Access Key ID 的不可逆摘要用于主体命名空间；跨项目优先使用平台返回的 `union_id`，不存在时使用项目范围 `open_id`。不同项目的 `open_id` 不按昵称或客户端 UID 自动合并；需要同一话题在两种渠道通用时，应取得同一开发者下稳定的 `union_id`，否则分别重新绑定对应渠道。

H5 项目公共发布 URL 为 `<gatewayOrigin>/h5`，每位主播使用自己最近一次在原站点明确批准的绑定作为下次启动的话题。需要固定某个已批准话题的独立来源时，可使用 `<gatewayOrigin>/h5?bindingId=<已批准绑定>`；修改此参数不能访问其他主播绑定。平台添加签名场景参数后才算平台启动；直接访问这些地址没有有效签名时始终空白。`plug_env=1` 仅提供有限设置页，`plug_env=0` 为实际展示页。当前 H5 验签采用 `Caller`、`Code`、`Mid`、`Timestamp` 的 ASCII 字典序、无尾部换行 HMAC-SHA256，拒绝重复参数和重放；本实现接受 10 分钟内时间戳及最多 30 秒未来时钟偏移。缓存的旧启动链接需重新从平台获取，不能绕过过期限制。

官方 H5 文档仍示例 `X-Frame-Options: ALLOW-FROM`，该指令已不被现代浏览器支持。本实现使用 CSP `frame-ancestors` 限定网关自身和 `https://play-live.bilibili.com`，真实直播姬容器有额外祖先时应依据实际官方容器来源精确调整，不能使用任意来源通配。[H5 文档](https://open-live.bilibili.com/document/ad4901b8-c13e-7a20-e07e-410ad182564a)、[MDN 浏览器行为](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options)

## 可选平台配对与运行协议

以下流程仅属于可选官方接入，不能替代默认桌面的风铃设备授权。完整站点协议见 [LIVE-CONTRACT.md](LIVE-CONTRACT.md)。网关 HTTP API 均为 JSON、不使用管理员 Cookie：

1. 网页控制台向原站点 `/control/binding-challenge` 取得 `{nonce,siteId,topicId,siteOrigin}`。
2. 向网关 `POST /api/pairings` 提交上述字段及同源 `returnUrl`，可选 `siteBaseUrl`（默认 `<siteOrigin>/api/mail/live`）。返回 `{pairingId,pairingUrl,completionToken,expiresAt}`；只打开 `pairingUrl`，完成凭证保留在发起控制端。
3. 网关配对页使用平台验证身份码后签发 binding JWT，经原站点 `returnUrl` 的 fragment 返回。原站点管理员明确批准并调用本地 `/control/bind`。
4. 本地批准成功后，控制端 `POST /api/pairings/:id/complete`，Bearer 为 `completionToken`，正文 `{bindingId}`。相同绑定允许重试。网关只登记可展示目的地，不向站点发起 HTTP 请求。

选择实现官方桌面启动的客户端可用 `POST /api/sessions/start {channel:"desktop",code}` 启动网关会话；该接口保留在网关中，不是当前桌面默认启动步骤。只有平台 API 成功返回的主体可信；客户端提供的 `room_id`、UID 和频道参数不能选择任意项目 ID。接口返回 `{sessionId,sessionToken,subject,bindings}`，令牌只用于网关平台会话，不是信箱权限。

已存在平台会话可用 `POST /api/sessions/:id/bind`，Bearer 为 `sessionToken`，正文 `{challenge,siteBaseUrl?}`，获得 `{proof,bindingId,pairingId,completionToken}`，然后依次执行上述站点批准和网关完成。`POST /api/sessions/:id/select {bindingId}` 可在已获批准的话题之间选择下次 H5 启动的目的地；它不会改变当前已经打开的来源或使信件上屏。控制端每秒调用 `/api/sessions/:id/keepalive`，或以下 proof/lease 接口保持消费者存活。

展示时 `POST /api/sessions/:id/display {bindingId}` 返回 60 秒一次性 display JWT；浏览器直接向站点 `/gateway/exchange` 兑换仅展示凭证。每 45 秒以新 proof 调用 `/gateway/renew` 延长同一凭证和接收端。新平台会话必须重新兑换并 `display/open`，加入后保持空白。

`POST /api/sessions/:id/lease {bindingId}` 返回 3 秒 platform lease JWT，每秒刷新。H5 壳仅向同源独立 iframe 传递 proof 和 lease；子页面验证父窗口、精确 origin 和一次性 bridge ID，站点对每个 frame/asset 请求中的 `X-WindChime-Platform-Lease` 再执行签名及绑定校验。缺少或过期立即拒绝，显示端独立 watchdog 清屏。

网关使用官方 `start`、20 秒项目心跳及 `end`；HTTP 200 仍核对业务 `code`，精确字符串请求体参与 MD5，时间戳为秒，`app_id` 不经 JavaScript Number 截断。平台心跳失败、消费者 10 秒失联或结束时，先停止签发任何新 lease，再尽力调用平台 end。平台退出失败不会恢复展示资格。活动会话不落盘，网关重启必须重新启动平台会话。[统一鉴权](https://open-live.bilibili.com/document/74eec767-e594-7ddd-6aba-257e8317c05d)、[生命周期 API](https://open-live.bilibili.com/document/eba8e2e1-847d-e908-2e5c-7a1ec7d9266f)

## 历史验证与后续启用条件

既有网关构建、签名、防重放、隔离、模拟生命周期、真实网关签名与站点契约测试，以及 OBS 浏览器源采集结果，保留在 [LIVE-VALIDATION.md](LIVE-VALIDATION.md) 和 [LIVE-CAPTURE-VALIDATION.md](LIVE-CAPTURE-VALIDATION.md) 等报告中。这些报告记录的是各自执行时的版本、进程及范围；浏览器源采集不能代表桌面窗口捕获，模拟平台接口也不能代表真实平台接入。本文不重复旧进程和账户状态，不声称本轮重新运行或通过这些测试。

维护可选模块时，可在根库构建后于 `apps/live-gateway` 执行 `npm run build`、`npm run check`、`npm test`、`npm run test:integration`。平台响应由测试夹具模拟，命令不需要真实密钥。Dockerfile 与 Compose 是部署材料，其实际构建与运行结果需单独记录。

若未来重新选择官方启动或上架，才需要核实相应项目类型、权限、H5 签名配置、HTTPS 地址、API/IP 限制及测试房间范围，并完成真实容器和生命周期联调。官方文档所述未上架测试房间限制属于平台 API 接入条件，不适用于本地窗口捕获。[鉴权错误 5004/5011](https://open-live.bilibili.com/document/74eec767-e594-7ddd-6aba-257e8317c05d) 本模块不消费弹幕/礼物消息；实际项目如果要求额外长连接或 SDK 回调，需要另行实现并验证。

已有项目和私有配置无需因本次范围调整而删除、修改或公开。当前目标与可选模块的状态应分别理解：

| 范围 | 定位与验证边界 |
| --- | --- |
| 本地桌面与独立窗口采集 | 当前交付目标；不依赖平台密钥或项目，按本轮桌面与采集记录验收 |
| 普通独立浏览器展示 | 保留的可选展示方式；无需 B 站密钥，历史结果见对应报告 |
| 网关、H5、生命周期与签名契约 | 保留的可选代码模块；历史模拟和契约测试不等同于真实平台验收 |
| 官方直播姬启动与真实平台 API 联调 | 不属于当前交付目标，未声明完成 |
| 平台审核上架 | 不属于当前交付目标，未声明提交或通过 |
