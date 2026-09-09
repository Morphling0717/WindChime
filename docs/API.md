# 公共接口

所有入口都来自同一个 `@windchime/embed` 包。`/core`、`/client`、`/react`、`/media` 不导入默认组件或 CSS；数据库与管理员授权配置只放在服务端。

## 客户端与错误

```ts
import { createWindChimeClient } from "@windchime/embed/client";
const client = createWindChimeClient({
  baseUrl: "/api/mail",
  credentials: "same-origin",
  // 可选：fetch、自定义 getHeaders（同步或异步返回 HeadersInit）
});
```

`getHeaders` 在每次请求时读取，适合现有密码 Header 或会话令牌；cookie 默认使用 `same-origin`。列表、详情、设置、词库、屏蔽列表读取及信件操作的 options 支持 `signal`，可传入 AbortSignal。所有请求使用 `cache: 'no-store'`。

HTTP 失败和 fetch 失败抛出 `WindChimeClientError`，包含 `code`、`status`、`message` 和可选 `retryAfterMs`。本地校验或没有 HTTP 响应时 status 可为 0；未提供服务器错误码时使用 `HTTP_状态码`。请求取消对应 `ABORTED`。自定义 `getHeaders`、响应体读取或更新监听器自身抛出的异常仍需调用方捕获，可用 `asWindChimeClientError(error)` 转为统一类型。网站按 code 决定展示文案，不应匹配服务器 message 字符串。

| client 操作                                                             | HTTP                                        | 返回值及参数                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `messages.submit(payload,{signal?}?)`                                   | POST `/messages`                            | `{ok:true}`；payload 为 `text/nickname/linkUrl/topicSlug/senderFingerprint/turnstileToken`  |
| `messages.list({topicId?,filter?,signal?}?)`                            | GET `/messages`                             | `{items,counts}`；filter 为 all/unread/favorited/flagged，默认 all                          |
| `messages.detail(id,{topicId?,signal?}?)`                               | GET `/messages/:id`                         | `WindChimeMessageRecord`，管理员明确请求原文                                                |
| `messages.update(id,patch,{topicId?,signal?}?)`                         | PATCH `/messages/:id`                       | `{ok:true}`；patch 的 isRead/isFavorited/isFlagged 必须为布尔                               |
| `messages.delete(id,{topicId?,signal?}?)`                               | DELETE `/messages/:id`                      | `{ok:true}`，软删除                                                                         |
| `messages.batch(action,ids,{topicId?,signal?}?)`                        | POST `/messages/batch`                      | `{ok:true}`；action 为 delete 或 markRead；每次 1–500 个 ID，必须属于同一目标话题           |
| `messages.block(id,{topicId?,signal?}?)`                                | POST `/messages/:id/block`                  | `{ok:true}`；全局屏蔽，并软删该发送者全部话题内的历史                                       |
| `topics.list({includeArchived?,signal?}?)/get(id,{signal?}?)`           | GET `/topics[/:id]`                         | 旧自动公开/管理员读取，返回 `{items:WindChimeTopic[]}` / `WindChimeTopic`                   |
| `topics.listPublic({signal?}?)/getPublic(id,{signal?}?)`                | GET `/topics[/:id]?view=public`             | `{items:WindChimePublicTopic[]}` / `WindChimePublicTopic`；即使登录也只返回公开字段         |
| `topics.listAdmin({includeArchived?,signal?}?)/getAdmin(id,{signal?}?)` | GET `/topics[/:id]?view=admin`              | `{items:WindChimeAdminTopic[]}` / `WindChimeAdminTopic`；必须通过授权                       |
| `topics.create(input)`                                                  | POST `/topics`                              | AdminTopic；input 为 slug、title、description、note、isEnabled、startsAt、endsAt、sortOrder |
| `topics.update(id,patch)`                                               | PATCH `/topics/:id`                         | AdminTopic；slug 不可修改，其他创建字段可部分更新                                           |
| `topics.archive(id,{markReadFirst?}?)`                                  | DELETE `/topics/:id`                        | `{topic:AdminTopic,unreadCount,flaggedCount}`；可原子标已读再归档，排除待审核信件           |
| `topics.restore(id)`                                                    | PATCH `/topics/:id`                         | AdminTopic；等价 `{archivedAt:null}`                                                        |
| `topics.purge(id)`                                                      | DELETE `/topics/:id/purge`                  | `{ok:true,topic:AdminTopic}`；只允许已归档非默认话题及其全部信件                            |
| `settings.get({signal?}?)/set(enabled)`                                 | GET/PUT `/settings`                         | `{enabled:boolean}`，映射默认话题开关；set 接收布尔值                                       |
| `blockedTerms.get({signal?}?)/set(terms)`                               | GET/PUT `/blocked-terms`                    | `{terms:string[]}`；set 接收数组并覆盖词库                                                  |
| `blocklist.list({signal?}?)/unblock(hash)`                              | GET `/blocklist`、DELETE `/blocklist/:hash` | `WindChimeBlockedSender[]` / `{ok:true}`；解封不会恢复已删除信件                            |

表中的 AdminTopic/PublicTopic 是 `WindChimeAdminTopic`/`WindChimePublicTopic` 的简称。公开列表仅列出正在收信的非默认话题；公开详情可按 ID 或 slug 读取默认、未开始、已结束及已归档话题，供网站展示对应状态页。AdminTopic 的 `note` 为 `string|null`，管理统计可选；管理列表带统计，创建、更新和详情不保证带统计。PublicTopic 不含 note、unreadCount、flaggedCount。旧 `WindChimeTopic` 仅用于兼容，服务端对象不会自动变为公开对象。

`topics.list/listAdmin` 默认不包含归档话题，传 `includeArchived:true` 会添加 `include=archived`；`listPublic` 不提供归档列表。常规信箱 ID/slug 为 `default`，未传 topicId/topicSlug 时使用它。`topicId=all` 仅用于管理列表的跨话题汇总（包括归档话题）；详情、修改、删除、屏蔽和批量操作仍须传实际话题。信件 DTO 中 `topicId` 因旧类型兼容可选，但新版服务端会返回。

在提供的路由适配器中，全部管理 HTTP 操作都经过宿主授权；匿名请求可以投稿、读取公开话题和营业设置。`messages.update(id,{isFlagged:false},scope)` 是审核放行接口。

## Hooks

在组件中用 `useMemo` 保持 client 实例稳定。相同 client 的成功 mutation 会通知受影响资源重新加载；HTTP 失败不发布更新通知。这个通知只作用于当前 client 实例，不是跨标签页或跨进程广播。需要定时获取其他客户端的改动时，数据 Hooks 的 options 可配置 `pollIntervalMs`。

数据 Hooks 通常返回 `isLoading/error/reload`，有写入操作的还返回 `pending/mutationError`。`enabled:false` 停止自动读取和轮询并隐藏数据，**不能作为管理员鉴权或禁用所有写操作的安全边界**。授权始终由服务端执行。

| Hook                                                                       | 主要参数与返回值                                                                                                                                                                               |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useWindChimeSubmission(options)`                                          | 必须提供 client 或 onSubmit；若两者都有，使用 onSubmit。返回 text/nickname/linkRaw/turnstileToken 及各自 setter、canSubmit、submit、sending、success、error、retryAfterMs、reset、clearSuccess |
| `useWindChimeInbox(client,{topicId?,filter?,enabled?,pollIntervalMs?}?)`   | items/counts/filter/setFilter、selectedIds、toggleSelected/toggleAll/clearSelection、allSelected/someSelected；update、markRead、toggleFavorite、deleteMessage、blockSender、batch、exportCsv  |
| `useWindChimeTopics(client,options?)`                                      | items、create/update/archive/restore/purge；默认 `{mode:'admin',includeArchived:true}`。公开页传 `{mode:'public'}`，items 类型变为 PublicTopic[]                                               |
| `useWindChimeReview(client,{topicId?,enabled?,pollIntervalMs?}?)`          | 继承 flagged 收件箱能力；openDetail/closeDetail、detail/detailLoading/detailError、approve；关闭、禁用或换话题后隐藏旧原文                                                                     |
| `useWindChimeBlocklist(client,options?)`                                   | items、unblock(hash)                                                                                                                                                                           |
| `useWindChimeBlockedTerms(client,options?)`                                | terms、save(terms)                                                                                                                                                                             |
| `useWindChimeSettings(client,options?)`                                    | data 为 `{enabled}` 或 null；setEnabled(boolean)                                                                                                                                               |
| `useWindChimeTurnstile(containerRef,{siteKey?,theme?,onToken?,onExpire?})` | token/error/isLoading/reset；ref 指向宿主创建的 HTMLElement，theme 为 auto/light/dark；不传 siteKey 不加载脚本                                                                                 |
| `useWindChimePosterConfig(initial,{storageKey?}?)`                         | value/setValue/update；initial 的 heading/body/footer/avatarSrc 由宿主提供，配置只在浏览器本地持久化                                                                                           |
| `useWindChimeSelection(ids,scope?)`                                        | 独立选择状态；scope 或可见 ID 改变时剔除旧选择，不发请求                                                                                                                                       |
| `useWindChimeDetail(loadDetail,{id?,scope?,enabled?})`                     | 自定义详情传输；返回 detail/isLoading/error/reload，关闭或换 scope 不接纳旧结果                                                                                                                |

错误处理有三种约定，不要混用：

- `form.submit(): Promise<boolean>` 内部捕获失败并返回 false，失败保留草稿。只有返回 true 才表示投递完成；`success` 由 `clearSuccess()` 或 `reset()` 清除，不自动定时消失。
- `reload(): Promise<void>` 将读取失败放入 error；`openDetail(id)` 返回 void，随后读取结果体现在 detailLoading/detailError，不能把它当 Promise 使用。
- 管理 mutation 返回业务 Promise；失败设置 mutationError，**同时继续抛出异常**，UI 必须 catch。pending=false 只表示请求结束，不表示成功。刷新读取失败会单独体现在资源 error。

投稿 options 还支持 `topicSlug`、`enabled`、`requireTurnstile`、`maxLength/nicknameMaxLength/linkMaxLength`、`rateLimit:false|{max,windowMs,storageKey}`、`senderFingerprintKey`、`disableSenderFingerprint` 和 `blockedTerms`。默认冷却记录键为 `windchime:rl`，浏览器指纹键为 `windchime:fp`。长度选项用于前端限制，不能提高服务端上限。可选的客户端 blockedTerms 会直接阻止提交；服务端词库则保留投稿并送审核，两者用途不同。

使用 Turnstile 时，将 onToken 接到 `form.setTurnstileToken`，并在每次提交尝试完成后调用 challenge.reset()；失败也可能已消耗旧 token。错误提示、确认弹窗、HTML、导航、动画和音效都由网站决定。Turnstile 挑战本身由 Cloudflare 渲染，只有该服务支持的主题可以配置。

## 核心类型与校验

`/core` 导出上述业务 DTO、`WindChimeError`、`validateWindChimeSubmission`、`validateWindChimeTopicCreate`、`validateWindChimeTopicPatch`。校验返回规范化后的输入或抛出 WindChimeError；服务端也使用同一实现。数据库约束、当前话题状态及 patch 与既有时间窗合并后的检查仍由服务端完成。

同入口提供 `normalizeWindChimeTerms`、`matchWindChimeBlockedTerm`、`filterWindChimeMessages`、`countWindChimeMessages`、`isWindChimeTopicOpenNow`、`toWindChimePublicTopic`，以及 `windChimeLocalToUtcIso`、`windChimeUtcIsoToLocal`、`windChimeNowAsLocal`、`windChimePlusDaysAsLocal`、`windChimeFormatInTimeZone`。时间工具默认时区为 Asia/Shanghai，可传入 IANA 时区；数据库/API 时间使用带时区的 ISO 8601，存储为 UTC。

正文最多 1000、称呼 32、链接 500 字符；省略协议的域名补为 https，只接受 HTTP(S)。话题标题最多 64、说明/内部备注各 500；slug 为 1–64 个小写字母、数字和短横，首尾为字母或数字，default/new/admin/api/m 为保留字。时间窗两端可为空，开始时间不得晚于结束时间；在开始和结束时刻均可收信。默认话题只允许修改 title/description/isEnabled，不能归档或删除；归档话题须先恢复才能编辑。

服务端限流为 IP 每分钟 5 条、每小时 20 条，浏览器指纹每小时 30 条；客户端默认 3 条/分钟只是体验提示。稳定发送者身份沿用 `SHA256(IP + '\n' + UA + '\n' + fingerprint + '\n' + salt)`，不是不可绕过的身份认证。

敏感词命中后保存并标记 isFlagged。all/unread/favorited 列表及对应计数排除待审核信件；flagged 列表的 text 为空、nickname/linkUrl 为 null，显式详情操作才返回信件原文。公开投稿返回最小 `{ok:true}`，包括已屏蔽发送者，不返回 hash 或管理状态。

## 服务端、路由和 SQLite

`createWindChimeSqlite({filename,busyTimeoutMs?,defaultTopicTitle?})` 返回 storage。filename 必填，可以是持久文件路径或测试用 `:memory:`；默认 busyTimeoutMs 为 5000，defaultTopicTitle 为“常规信箱”。目录自动创建；`storage.ready` 是初始化 Promise，失败阻止后续操作。`get/all/run/transaction/close` 是公开存储接口。

`storage.transaction(async tx => ...)` 内只调用 tx.get/all/run，不递归调用 storage，不等待网络、鉴权或另一个连接。工厂不做跨模块全局缓存；Next 宿主应像示例一样在 globalThis 缓存服务，CLI 在 finally 调用 storage.close()。

`createWindChimeService({storage,hashSalt,ready?,blockedTerms?,turnstileSecret?,getClientIp?,fetch?,now?})` 返回下表服务。hashSalt 必须显式提供并长期保持；新项目用随机非空值。ready 是等待宿主旧迁移完成的回调，库先等待 storage.ready，再调用它。blockedTerms 可为数组或逗号分隔字符串，只在数据库尚无词库设置时作为默认值。

| service 方法                                                                                 | 用途与返回                                              |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `ready()`                                                                                    | 等待库初始化和宿主 ready 回调                           |
| `submitMessage(payload,request)`                                                             | 投稿，返回 `{ok:true}`                                  |
| `listMessages({topicId?,filter?}?)`                                                          | `{items,counts}`                                        |
| `getMessage(id,topicId?)`                                                                    | 管理原文详情                                            |
| `updateMessage(id,patch,topicId?)`、`deleteMessage(id,topicId?)`、`blockSender(id,topicId?)` | 信件管理，返回 `{ok:true}`                              |
| `batchMessages({action,ids},topicId?)`                                                       | 同话题批量管理                                          |
| `listPublicTopics()`、`getPublicTopic(idOrSlug)`                                             | PublicTopic[] / PublicTopic 或 null，供公开 SSR         |
| `listTopics({includeArchived?,withCounts?,onlyPublicActive?}?)`                              | **始终返回 AdminTopic[]**；默认不含归档、不带统计       |
| `getTopicById(id)`、`getTopicBySlug(slug)`、`getDefaultTopic()`                              | AdminTopic 或 null；不能直接传到公开页面                |
| `createTopic(input)`、`updateTopic(id,patch)`、`restoreTopic(id)`                            | AdminTopic                                              |
| `archiveTopic(id,{markReadFirst?}?)`                                                         | `{topic,unreadCount,flaggedCount}`                      |
| `deleteArchivedTopic(id)`                                                                    | 被永久删除的 AdminTopic（区别于 HTTP purge 的包装对象） |
| `getTopicCounts(id)`                                                                         | `{unreadCount,flaggedCount}`                            |
| `getSettings()`、`updateSettings({enabled})`                                                 | `{enabled}`；注意服务端 updateSettings 接收对象         |
| `getBlockedTerms()`、`setBlockedTerms(terms)`                                                | string[]（区别于客户端的 `{terms}`）                    |
| `listBlockedSenders()`、`unblockSender(hash)`                                                | 屏蔽数组 / `{ok:true}`                                  |

service 方法供受信任服务端代码调用，**不在内部鉴权**。公开 HTTP 应通过 `createWindChimeRouteHandlers({service,authorizeAdmin,hasAdminAccess?,basePath?,onError?})` 挂载，返回 GET/POST/PUT/PATCH/DELETE；不依赖 Next.js 私有 Request 类型。

- authorizeAdmin 必填：返回 Response 拒绝；false 返回默认 401；null/undefined/true 表示通过。可同步或异步。
- hasAdminAccess 是可选的静默读取：只影响旧自动 topic GET；缺省只返回公开数据。`view=admin` 始终要求 authorizeAdmin，`view=public` 始终用公开投影。
- basePath 默认 `/api/mail`；onError 用于记录未预期错误，HTTP 响应不暴露 SQL 或内部异常。

`/server` 另导出 `getWindChimeClientIp` 和 `computeWindChimeSenderIdentity`，供接入已有身份逻辑时复用。默认可信代理头次序及登录适配见根 README。

## 无界面分享能力

| 接口                                                                               | 行为                                                                                                                       |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/client` 的 `windChimeMessagesToCsv(rows,{headers?,bom?}?)` 或 `client.exportCsv` | 返回 CSV 字符串；headers 是列名映射，默认包含 UTF-8 BOM，并转义引号、换行和电子表格公式                                    |
| `downloadWindChimeCsv(rows,filename,options?)`                                     | 浏览器下载当前传入的行，不另行拉取全部信件                                                                                 |
| `/media` 的 `renderWindChimeQr(canvas,options)`                                    | 返回 Promise<void>；options 至少包含 url，可选 size、颜色、margin、纠错级别、Logo、pixelRatio、qrcodeLib                   |
| `renderWindChimePoster(qrCanvas,{url,...})`                                        | 返回 Promise<HTMLCanvasElement>，不会自行下载；可选 heading/body/footer、gradient、背景图、头像、textColor 和 brandingText |
| `windChimeCanvasToBlob(canvas)`                                                    | 返回 Promise<Blob>，供网站自行上传或导出                                                                                   |
| `downloadWindChimeCanvas(canvas,filename)`                                         | 返回 Promise<void>，下载 PNG                                                                                               |
| `readWindChimePosterConfig(key,fallback,storage?)`                                 | 返回配置；存储不可读或数据无效时使用 fallback                                                                              |
| `writeWindChimePosterConfig(key,value,storage?)`                                   | 返回 boolean；false 表示未持久保存                                                                                         |

画布操作在浏览器执行。先 await render 完成，再启用下载按钮；媒体函数失败会 reject 原生 Error，**不是 WindChimeClientError**。可选海报模板在背景图或头像加载失败时会保留底色或略过头像，不会因此 reject。二维码 Logo 加载失败或画布导出失败会 reject。使用配置 Hook 时，存储写入失败仍保留本次内存值，不保证刷新后保留。

默认 QR 尺寸 320、纠错级别 H，默认海报宽 900。媒体函数不会添加风铃品牌字样；brandingText 仅在显式传入时绘制。要完全控制海报布局、字体或绘制顺序，可以直接组合二维码画布与自己编写的 canvas 渲染。可注入 qrcodeLib，否则安装可选 qrcode 依赖。图片跨域许可及 B 站头像代理由宿主负责。

## 特殊端点与自定义传输

旧接口可以通过 `endpoints` 覆盖资源 URL，键为 messages/topics/settings/blockedTerms/blocklist。例如 `{endpoints:{settings:'/api/inbox-state'}}`；覆盖 URL 原有查询参数会保留，客户端继续追加业务查询参数。

`client.request<T>(path,method='GET',body?,{signal?,topicId?}?)` 是低层统一请求；path 相对于 baseUrl，完整绝对 URL 配合 `baseUrl:''` 使用。直接调用 request 不会自动发布资源更新，写入后可用 `client.invalidate(['messages','topics'])` 通知 Hooks。`client.subscribe(listener)` 返回取消订阅函数。普通接入优先使用上面的业务方法，避免自行复制刷新依赖关系。
