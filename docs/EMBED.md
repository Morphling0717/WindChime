# `@windchime/embed` 网站集成指南（开发者文档）

`@windchime/embed` 是面向 Next.js（Node runtime）的独立匿名信箱库，负责投稿、信件管理、审核、话题、归档、屏蔽规则以及与风铃桌面控制台通信的直播控制协议；宿主网站完全掌控自己的页面 HTML、样式、文案、数据库路径与管理员登录。

> 如果你是主播，只想下载使用 Windows 桌面端，请直接看 [首页 README](../README.md)。

---

## 快速体验内置示例

前提：Node `>= 20.19`、npm `>= 10`、可写的本地磁盘。

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

打开 `http://localhost:3010` 体验投稿，打开 `http://localhost:3010/admin` 体验管理后台。完整示例源码位于 [examples/next-sqlite](../examples/next-sqlite)。

---

## 集成到已有 Next.js 网站

### 1. 安装依赖

在风铃源码目录执行 `npm pack` 生成压缩包并安装到宿主网站：

```bash
npm install /你的路径/WindChime/windchime-embed-1.1.0.tgz sqlite3@6.0.1
# 如需粉丝附图与主播替换图片
npm install sharp@0.35.4
# 如需二维码与海报生成
npm install qrcode
```

在 `next.config.ts` 中合并以下配置：

```ts
const nextConfig = {
  transpilePackages: ["@windchime/embed"],
  serverExternalPackages: ["sqlite3", "sharp"],
};
export default nextConfig;
```

### 2. 环境变量与数据库初始化

```dotenv
DATABASE_PATH=data/mail.db
WINDCHIME_HASH_SALT=生成一次并长期保留的随机字符串
TURNSTILE_SECRET=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
```

> `WINDCHIME_HASH_SALT` 用于匿名发送者哈希识别，**请生成后长期固定，不要随意更换**，否则旧的屏蔽记录将无法匹配新投稿。

初始化数据库（幂等）：

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

### 3. 接入服务端与 API 路由

```ts
// lib/mail.ts（仅服务端导入）
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

挂载 Next.js Route Handler：

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

### 4. 客户端投稿组件示例

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
      <textarea value={form.text} onChange={(e) => form.setText(e.target.value)} />
      <button disabled={!form.canSubmit}>投递</button>
      {form.success && <p role="status">已投递</p>}
      {form.error && <p role="alert">{form.error.message}</p>}
    </form>
  );
}
```

---

## 模块导出入口

| 入口 | 用途 |
| --- | --- |
| `@windchime/embed/core` | 纯类型、校验、话题状态与公开数据投影 |
| `@windchime/embed/client` | 类型化 API 客户端、结构化错误、CSV 导出 |
| `@windchime/embed/react` | 无界面 React Hooks（投稿、收件箱、话题、审核、屏蔽、设置） |
| `@windchime/embed/server` | 投稿、审核、直播控制与屏蔽核心业务逻辑 |
| `@windchime/embed/sqlite` | SQLite 存储初始化、迁移与事务 |
| `@windchime/embed/next` | Next.js 标准 `Request` / `Response` 处理器 |
| `@windchime/embed/media` | 二维码与投稿海报生成 |
| `@windchime/embed/broadcast` | 直播控制台、盲盒模式、展示卡片与外观编辑器组件 |
| `@windchime/embed/ui` | 可选默认 UI 组件 |

## 延伸技术文档

- [API 接口说明](API.md)
- [连接密钥协议](CONNECTION-KEYS.md)
- [展示排版与主题设计](DISPLAY-DESIGNS.md)
- [数据库升级与迁移说明](MIGRATION.md)
- [开发与发布说明](DEVELOPMENT.md)
- [开源许可与第三方声明](LICENSES.md)
