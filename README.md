# @windchime/embed

风铃是面向 Next.js 的独立匿名信箱库。投稿、信件管理、审核、话题、归档和屏蔽规则由库维护；网站拥有页面 HTML、布局、样式、文案、图标、动画、数据库路径和管理员登录。

**0.5.0 为待发布版本。** 当前不要求 npm registry 已有该版本；可以从本仓库构建 `.tgz` 安装。源码与 ESM 产物均按职责分文件。默认 UI 是可选入口，完全不使用它也能使用全部功能。

## 从可运行示例开始

前提：Node >=20.19、npm >=10、可写的本地磁盘。SQLite 采用 `sqlite3@6.0.1`，运行在 Next.js Node runtime。原生驱动应在目标运行平台安装，不能复制 macOS 的 node_modules 到 Linux。

```bash
# 在 WindChime 仓库根目录
npm ci
npm test
cd examples/next-sqlite
npm ci --install-links
npm run setup
npm run db:init
npm run dev
```

打开 http://localhost:3010 投稿，http://localhost:3010/admin 管理。`setup` 创建 `.env.local`、随机管理员密码和两个独立秘密，仅首次运行输出密码；重复运行不会覆盖盐值或凭证。管理页面包含全部现有功能和二维码/海报下载。这个示例不用 Tailwind，也不导入风铃默认 UI。`/ui` 单独演示可选组件。

完整源代码都在本仓库的 [examples/next-sqlite](examples/next-sqlite)，无须参考消费网站；示例不打进 npm 包，运行示例时请使用风铃源码仓库。构建生产示例：`npm run build && npm start`；登录 cookie 在生产使用 Secure，生产访问请使用 HTTPS。

## 安装到已有网站

未公开发布时，在风铃目录执行 `npm pack`，在网站目录安装生成的包：

```bash
npm install /你的路径/WindChime/windchime-embed-0.5.0.tgz sqlite3@6.0.1
# 需要二维码和海报时
npm install qrcode
```

正式发布后可替换为 `npm install --save-exact @windchime/embed@0.5.0`。提交网站的 package.json 与 lockfile；不要把临时本地联调路径作为部署依赖。已有 Next.js 项目中合并以下配置，保留自己的其他选项：

```ts
// next.config.ts
const nextConfig = {
  transpilePackages: ["@windchime/embed"],
  serverExternalPackages: ["sqlite3"],
};
export default nextConfig;
```

SQLite 需要可持久保存的文件系统；不要将数据库放进会被部署替换的临时构建目录。使用原生驱动时，若 npm 无法使用该平台的预编译包，需要目标系统的 Python 和 C/C++ 编译工具链。

### 配置与数据库初始化

网站环境配置：

```dotenv
DATABASE_PATH=data/mail.db
WINDCHIME_HASH_SALT=生成一次并长期保留的随机字符串
TURNSTILE_SECRET=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
```

`WINDCHIME_HASH_SALT` 是匿名发送者识别盐，**更换会导致旧屏蔽记录无法匹配新投稿**。管理员登录秘密由网站自己的登录系统管理。没有 Turnstile 配置时不启用验证；启用时需同时设置公开 site key 和服务端 secret，`NEXT_PUBLIC_*` 变量在 Next 构建时注入。

独立新库初始化脚本：

```js
// scripts/init-mail.mjs
import { createWindChimeSqlite } from "@windchime/embed/sqlite";
const storage = createWindChimeSqlite({
  filename: process.env.DATABASE_PATH || "data/mail.db",
});
try {
  await storage.ready;
} finally {
  await storage.close();
}
```

运行 `node --env-file=.env.local scripts/init-mail.mjs`。初始化幂等，创建缺失的 mail_* 表和 `default` 话题，探测并迁移旧结构。任何真实迁移错误都会中止，不会当成“列已存在”吞掉。

### 服务与现有登录接入

```ts
// lib/mail.ts，仅服务端导入
import { createWindChimeSqlite } from "@windchime/embed/sqlite";
import { createWindChimeService } from "@windchime/embed/server";
import { createWindChimeRouteHandlers } from "@windchime/embed/next";
import { getCurrentAdmin } from "./你的现有登录模块";

const cache = globalThis as typeof globalThis & {
  mailService?: ReturnType<typeof createWindChimeService>;
};
export function getMailService() {
  return (cache.mailService ??= createWindChimeService({
    storage: createWindChimeSqlite({
      filename: process.env.DATABASE_PATH || "data/mail.db",
    }),
    hashSalt: process.env.WINDCHIME_HASH_SALT!,
    turnstileSecret: process.env.TURNSTILE_SECRET,
  }));
}
export function mailHandlers() {
  return createWindChimeRouteHandlers({
    service: getMailService(),
    hasAdminAccess: async (request) => Boolean(await getCurrentAdmin(request)),
    authorizeAdmin: async (request) => {
      if (!(await getCurrentAdmin(request))) {
        return Response.json({ error: "请先登录" }, { status: 401 });
      }
      return null;
    },
  });
}
```

此处唯一需要替换的 `getCurrentAdmin(request)` 是网站现有登录检查。新项目可以直接使用示例内完整的 [会话实现](examples/next-sqlite/lib/auth.ts) 和 [登录路由](examples/next-sqlite/app/api/session/route.ts)。授权回调缺失不会自动开放管理操作；服务端 service 方法本身用于受信任代码，不应直接暴露成未鉴权的 Server Action。

使用 cookie 登录时，宿主也应在写操作校验请求来源；示例提供同源校验。若旧登录逻辑需要读取 JSON 密码，使用 request.clone().json()，保留原请求体供业务处理器读取。`hasAdminAccess` 是静默读取，不应把匿名公开请求计入登录失败次数。两个网站原有密码兼容及登录锁定继续由宿主保留。

`getClientIp(request)` 可在 service 配置中替换，应按照自己的可信代理配置实现。默认沿用既有 CF-Connecting-IP → X-Real-IP → X-Forwarded-For 最右项的次序；这些头只有在可信反向代理覆盖它们时才可信。

### 挂载 API

```ts
// app/api/mail/[...windchime]/route.ts
import { mailHandlers } from "@/lib/mail";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => mailHandlers().GET(req);
export const POST = (req: Request) => mailHandlers().POST(req);
export const PUT = (req: Request) => mailHandlers().PUT(req);
export const PATCH = (req: Request) => mailHandlers().PATCH(req);
export const DELETE = (req: Request) => mailHandlers().DELETE(req);
```

保留已有的更具体会话/图片代理路由即可。更改挂载前缀时，同步配置处理器 `basePath` 和客户端 `baseUrl`。

### 自己编写投稿界面

```tsx
"use client";
import { useMemo } from "react";
import { createWindChimeClient } from "@windchime/embed/client";
import { useWindChimeSubmission } from "@windchime/embed/react";
export function Compose({ topicSlug = "default" }) {
  const client = useMemo(() => createWindChimeClient(), []);
  const form = useWindChimeSubmission({ client, topicSlug });
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await form.submit();
      }}
    >
      <label>
        内容
        <textarea
          value={form.text}
          onChange={(e) => form.setText(e.target.value)}
        />
      </label>
      <button disabled={!form.canSubmit}>投递</button>
      {form.success && <p role="status">已投递</p>}
      {form.error && <p role="alert">{form.error.message}</p>}
    </form>
  );
}
```

这段代码无需 CSS 或默认组件。昵称、链接、Turnstile 的完整例子见 [Sender.tsx](examples/next-sqlite/app/Sender.tsx)。错误提供 `code/status/retryAfterMs`，网站可按 code 显示自己的文案。`submit()` 捕获错误并返回 false；管理写入方法则继续抛出错误，需要 catch。Hooks 不弹确认框、不导航、不播放音效。成功动画与音效在网站收到 `submit()` 的 true 结果后执行。

### 自己编写管理界面

用同一个稳定 client 实例调用 `useWindChimeInbox(client, {topicId})`、`useWindChimeTopics(client)`、`useWindChimeReview`、`useWindChimeBlocklist`、`useWindChimeBlockedTerms`、`useWindChimeSettings`。数据更新会通知同一 client 实例下的相关 Hooks 重新加载；过期请求不会覆盖新话题。`useWindChimeTopics` 默认读取管理数据，公开页面使用 `{mode:"public"}`，或直接调用 `client.topics.listPublic()`。不同标签页或客户端实例之间需要主动刷新或配置轮询。

完整 [管理页面](examples/next-sqlite/app/admin/page.tsx) 提供登录、筛选、选择、已读/收藏、批量操作、审核、屏蔽、话题编辑/归档/恢复/永久删除、CSV 和海报。所有确认、HTML 与文案都由这个页面定义，业务不复制到示例里。

待审核信件列表中正文为空、昵称和链接为 null；管理员显式调用详情后才能展开信件原文。公开 SSR 使用 `service.listPublicTopics()` 和 `service.getPublicTopic(idOrSlug)`，不要把内部 `getTopicById` 的管理员对象传入 Client Component。

## 导入入口

| 入口                    | 内容                                             |
| ----------------------- | ------------------------------------------------ |
| `/core`                 | 无 React 的类型、校验、话题状态和公开数据投影    |
| `/client`               | 类型化 API 客户端、结构化错误、CSV               |
| `/react`                | 无界面 Hooks、Turnstile 生命周期、海报配置持久化 |
| `/server`               | 投稿、管理、话题、审核、屏蔽规则                 |
| `/sqlite`               | sqlite3 连接、初始化、迁移和事务                 |
| `/next`                 | 标准 Request/Response 处理器                     |
| `/media`                | 二维码、海报画布、下载及配置存取                 |
| `/ui` 或旧根入口        | 可选默认组件                                     |
| `/styles/windchime.css` | 可选 UI 动画样式                                 |

React 18/19 为 peer，sqlite3 和 qrcode 为可选 peer；仅使用客户端无需加载 SQLite。服务端和 headless 入口不依赖 Tailwind。默认皮肤使用 Tailwind 工具类，选择它时将包的 `dist/**/*.js` 加入 Tailwind 扫描，另引入动画 CSS。React Server Components 不导入客户端 Hooks；数据库接口声明 Node runtime。

## 功能与操作接口

详细接口、默认规则及返回值见 [API 说明](docs/API.md)。数据库升级与两站接入见 [迁移说明](docs/MIGRATION.md)。日常联调和版本分发见 [开发与发布](docs/DEVELOPMENT.md)。实际执行结果单独记录于 [验证记录](docs/VALIDATION.md)，不把未执行的发布/生产操作当成完成。

功能范围包括现有投稿、阅读/收藏、批量、审核、敏感词、屏蔽、话题、归档、恢复、永久删除、CSV、二维码与海报。没有新增回复系统或分页。
