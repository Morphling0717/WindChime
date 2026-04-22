# @windchime/embed

匿名「风铃」提问箱的可嵌入 React 组件库：

**投稿与管理**
- **投稿面板** `WindChimeSender`
- **浮动按钮 + 弹窗（内置禁用态）** `WindChimeFloatingButton`
- **Speed-Dial** `WindChimeSpeedDial`（主按钮展开多个子入口）
- **管理收件表格** `WindChimeAdminPanel`（分类 Tab / 批量 / 行操作 / 拉黑 / **待审核 tab**）
- **黑名单面板** `WindChimeBlocklistPanel`

**审核与安全**
- **待审核面板** `WindChimeFlaggedPanel`（默认折叠 + 点击查看原文 modal）
- **敏感词配置** `WindChimeBlockedTermsPanel`

**二维码与海报**
- **二维码卡** `WindChimeQrCard`
- **海报编辑器** `WindChimeQrPosterEditor`

**Mail Topics（多主题收件箱）** 🆕 0.4.0
- **主题 Tab 栏** `WindChimeTopicTabs`（染色 / 未读 badge / 快捷归档）
- **新建主题** `WindChimeNewTopicModal`（slug 校验 + 时间窗 + 永久活动二次确认）
- **归档确认** `WindChimeArchiveConfirmModal`
- **往期活动抽屉** `WindChimeArchivedTopicsDrawer`
- **访客端状态页** `WindChimeTopicStatePage`（已结束 / 暂停中 / 未开始 + 倒计时）
- **顶部活动横幅** `WindChimeActiveTopicsBanner`

**其它**
- 可选 **Cloudflare Turnstile** `TurnstileWidget`
- **时间 / 时区工具**（`windChimeLocalToUtcIso` / `windChimeFormatInTimeZone` 等）

本包只负责 UI 与轻量客户端逻辑；**持久化、鉴权、反滥用、真正的拉黑生效、跨主题路由规则都在宿主应用（例如 Next.js API Route）中实现**。示例参见 `examples/next-sqlite`。

> 🎐 **致敬**：本项目在产品形态上参考了日本的匿名提问服务 **[Marshmallow（マシュマロ）](https://marshmallow-qa.com)**，提供类似的「粉丝匿名向创作者投递问题」体验，但实现、代码与 UI 均为独立编写，**与 Marshmallow 官方无任何关联**。

当前版本：`0.4.0`（见根目录 `package.json`）。

---

## 功能概览

| 能力 | 说明 |
|------|------|
| 投稿表单 | 多行正文、字数统计、可选昵称与外链、成功/错误提示、可选成功音效与风铃摆动动画 |
| 营业状态 | `status: 'open' \| 'paused'`，暂停时可选择是否仍展示面板（`showWhenPaused`） |
| 客户端冷却 | 基于 `localStorage` 的滑动窗口次数限制（可关闭）；**不能替代服务端限流** |
| 关键词拦截 | `blockedTerms` 子串匹配（不区分大小写）；**不能替代服务端审核** |
| 发送者指纹 | Sender 在 `localStorage` 生成并持续上报 `senderFingerprint`；服务端可与 IP/UA 叠加哈希成 `User-XXXX` 稳定标签 |
| Turnstile | 传入 `turnstileSiteKey` 时在提交前要求人机验证，并把 `turnstileToken` 交给 `onSubmit` |
| 收件箱分类 | Admin 面板内置「全部 / 未读 / 红心 / **待审核**」Tab，支持受控（`filter` + `onFilterChange`）或非受控（按 `items` 自动过滤） |
| 命中敏感词 | `isFlagged=true` 的消息**只在「待审核」tab 显示**，默认 `all/unread/favorited` 都自动隐藏；配合 `WindChimeFlaggedPanel` 做折叠 + 点击查看原文，防止直播切后台时糊脸 |
| 敏感词库 | `WindChimeBlockedTermsPanel` 一键编辑服务端敏感词库（受控 + 拉取两种模式） |
| 行级操作 | 收藏（`onToggleFavorite`）、已读切换（`onToggleRead`）、回复（`onReply`）、删除（`onDelete`）、拉黑（`onBlockSender`），发送者标签自动显示 |
| 批量操作 | 多选 + `onBatchDelete` / `onBatchMarkRead` |
| 黑名单 | `WindChimeBlocklistPanel` 展示被拉黑发送者并支持 `onUnblock` |
| 二维码 / 海报 | `WindChimeQrCard` 主题色前景 + 中心 Logo + 下载 PNG；`poster.enabled` 额外输出社交海报 |
| 海报编辑器 | `WindChimeQrPosterEditor` 为主播/管理员提供 heading/body/footer/avatar 表单，可选 `storageKey` 自动 localStorage 持久化 |
| 浮动按钮 | `WindChimeFloatingButton` 固定角落按钮 + 弹窗，内置「禁用态」灰化、ESC 关闭、可轮询 settings 端点 |
| Speed-Dial | `WindChimeSpeedDial` 主按钮展开 N 个子按钮（竖向），子按钮可独立禁用态 |
| Mail Topics | 多主题收件箱 UI 全套：tab 栏 / 新建 / 归档确认 / 往期抽屉 / 访客状态页 / 顶部活动横幅 |
| 时间工具 | `windChimeLocalToUtcIso` / `windChimeFormatInTimeZone`：datetime-local ↔ UTC ISO 双向转换，默认 `Asia/Shanghai`，也支持任意 IANA 时区（带 DST 的西时区也 OK） |
| 换肤 | 每个组件都接受 `theme`：传入 Tailwind `className` 片段覆盖默认样式；新组件的动画用 `windchime.css` 里的 CSS keyframes，不依赖 framer-motion / lucide-react / next-link |

组件根节点带有稳定 `data-widget` 属性（如 `windchime-sender / windchime-admin / windchime-blocklist / windchime-qr / windchime-letter / windchime-flagged / windchime-blocked-terms / windchime-topic-tabs / windchime-active-topics-banner / windchime-topic-state-page / windchime-speed-dial`），便于 E2E 或样式定位。

### 可选依赖

- `WindChimeQrCard` 运行时动态 `import('qrcode')`。宿主需 `npm i qrcode`（及 `@types/qrcode`）或通过 `qrcodeLib` prop 注入已加载的实例。

---

## 前置条件

- **React** `^18` 或 `^19`，且使用本组件的页面须为 **Client Component**（组件已带 `'use client'`）。
- **Tailwind CSS** `^3.4` 或 `^4`（推荐）：默认皮肤大量使用工具类。宿主必须在 `tailwind.config` 的 **`content`** 中扫描本包构建产物 **`dist/**/*.js`**（若直接消费 TS 源码则扫描 `src/**/*.{ts,tsx}`），否则页面几乎没有样式。
- `tailwindcss` 在 `peerDependencies` 中标记为 **optional**：若你完全用 `theme` 自行拼 class 且不依赖默认工具类，理论上可不装 Tailwind，但默认主题仍按 Tailwind 设计，**一般项目请安装并配置 Tailwind**。

---

## 安装与构建

### 作为本地包（monorepo / 相对路径）

在宿主 `package.json` 中增加依赖（路径按目录关系调整）：

```json
{
  "dependencies": {
    "@windchime/embed": "file:../WindChime"
  }
}
```

在 **WindChime 包根目录**执行一次构建，生成 `dist/`：

```bash
cd WindChime
npm install
npm run build
```

`prepare` 脚本会在作为依赖被安装时尝试执行 `build`；若 CI 禁用了生命周期脚本，请显式在流水线里跑 `npm run build`。

### npm 包字段说明

- **入口**：`import` → `./dist/index.js`，类型 → `./dist/index.d.ts`。
- **样式**：`import '@windchime/embed/styles/windchime.css'`（风铃摆动、成功条渐入动画；组件内部也会 `import` 一次，可按需再在布局中全局引入）。

---

## 接入 Next.js（推荐流程）

1. **安装依赖**  
   使用上文 `file:…` 或私有 registry 指向已含 `dist` 的包版本。

2. **使用已编译的 `dist`**（默认）  
   一般 **不需要** `next.config` 里的 `transpilePackages`。只有当你把依赖指到 **TypeScript 源码**而非 `dist` 时，才把 `@windchime/embed` 加入 `transpilePackages`。

3. **配置 Tailwind `content`**  
   在宿主 `tailwind.config.ts`（或 `.js`）中增加一项，使 JIT 能扫描到包内 class 字符串，例如：

   ```ts
   content: [
     "./app/**/*.{js,ts,jsx,tsx,mdx}",
     "./components/**/*.{js,ts,jsx,tsx}",
     "../WindChime/dist/**/*.js",
   ],
   ```

   路径请改成你仓库里 **WindChime 相对宿主项目** 的真实位置。

4. **在页面中使用**  
   在 `app/.../page.tsx` 中若需组合服务端内容，可将带 WindChime 的部分拆到子组件文件并在该文件顶部写 `'use client'`，或整页为客户端页面。

5. **（可选）全局引入动画 CSS**  

   ```ts
   import '@windchime/embed/styles/windchime.css';
   ```

### 最小接入示例

```tsx
'use client';

import { WindChimeSender } from '@windchime/embed';
import type { WindChimeSubmitPayload } from '@windchime/embed';
import '@windchime/embed/styles/windchime.css';

export function AskBox() {
  return (
    <WindChimeSender
      onSubmit={async (payload: WindChimeSubmitPayload) => {
        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: payload.text,
            nickname: payload.nickname,
            linkUrl: payload.linkUrl,
            turnstileToken: payload.turnstileToken,
          }),
        });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || '提交失败');
        }
      }}
    />
  );
}
```

管理端需自行拉取列表并传入 `items`，删除时调用你的 API 再在父组件里更新状态，例如：

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { WindChimeAdminPanel } from '@windchime/embed';
import type { WindChimeMessageRecord } from '@windchime/embed';
import '@windchime/embed/styles/windchime.css';

export function Inbox() {
  const [items, setItems] = useState<WindChimeMessageRecord[]>([]);

  const reload = useCallback(async () => {
    const r = await fetch('/api/messages');
    if (r.ok) setItems(await r.json());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <WindChimeAdminPanel
      items={items}
      onReload={() => void reload()}
      onDelete={async (id) => {
        const r = await fetch(`/api/messages/${id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error('删除失败');
        await reload();
      }}
    />
  );
}
```

---

## 导出清单

从 `@windchime/embed` 可导入：

| 符号 | 类型 |
|------|------|
| `WindChimeSender` | 组件 |
| `WindChimeFloatingButton` | 组件 |
| `WindChimeAdminPanel` | 组件 |
| `WindChimeBlocklistPanel` | 组件 |
| `WindChimeQrCard` | 组件 |
| `WindChimeQrPosterEditor` | 组件 |
| `DEFAULT_POSTER_CONFIG` | 常量 |
| `TurnstileWidget` | 组件（一般无需单独使用，`WindChimeSender` 已集成） |
| `TurnstileWidgetHandle` | `ref` 类型：`{ reset: () => void }` |
| `WindChimeSenderProps` / `WindChimeSubmitPayload` / `WindChimeTheme` / `WindChimeRateLimit` | 类型 |
| `WindChimeAdminPanelProps` / `WindChimeAdminTheme` / `WindChimeMessageRecord` / `WindChimeInboxFilter` | 类型 |
| `WindChimeBlocklistPanelProps` / `WindChimeBlockedSender` | 类型 |
| `WindChimeQrCardProps` / `WindChimeQrCardTheme` / `QrCodeLike` | 类型 |
| `WindChimeFloatingButtonProps` / `WindChimeFloatingButtonTheme` | 类型 |
| `WindChimeQrPosterEditorProps` / `WindChimeQrPosterEditorTheme` / `WindChimeQrPosterConfig` | 类型 |

---

## `WindChimeSender` 属性说明

| 属性 | 类型 | 默认 / 说明 |
|------|------|----------------|
| `onSubmit` | `(payload: WindChimeSubmitPayload) => Promise<void>` | **必填**。抛出 `Error` 时组件会显示 `message`。 |
| `title` | `ReactNode` | 默认「风铃」 |
| `status` | `'open' \| 'paused'` | `'open'` |
| `statusOpenLabel` / `statusPausedLabel` | `string` | 角标文案 |
| `tagline` / `pausedMessage` | `string` | 副标题；暂停且 `showWhenPaused=false` 时用 `pausedMessage` |
| `placeholder` / `maxLength` / `successMessage` | | 正文占位、上限（默认 1000）、成功提示 |
| `rateLimit` | `WindChimeRateLimit \| false` | 默认约 60 秒内 3 次；`false` 关闭 |
| `showWhenPaused` | `boolean` | `true`；`false` 时暂停只显示精简说明 |
| `collectNickname` / `nicknamePlaceholder` / `nicknameMaxLength` | | 可选称呼 |
| `collectLinkUrl` / `linkPlaceholder` / `linkMaxLength` | | 可选 http(s) 链接 |
| `turnstileSiteKey` | `string` | 设置后展示 Turnstile，并在 payload 中带 `turnstileToken` |
| `blockedTerms` / `blockedTermsMessage` | `string[]` / `string` | 客户端敏感子串拦截 |
| `successAudioSrc` | `string` | 成功后播放音频 URL |
| `enableSwayAnimation` | `boolean` | 默认 `true` |
| `theme` | `WindChimeTheme` | 覆盖各区域 `className` |
| `className` | `string` | 根容器 |

### `WindChimeSubmitPayload`（`onSubmit` 参数）

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | `string` | 已去首尾空白的正文 |
| `nickname` | `string \| null` | 未开启收集时为 `null` |
| `linkUrl` | `string \| null` | 规范化后的 http(s)，未填为 `null` |
| `turnstileToken` | `string \| null` | 未启用 Turnstile 时为 `null` |

### `WindChimeTheme`（节选）

常用键：`root`、`panel`、`header`、`title`、`statusOpen`、`statusPaused`、`tagline`、`textarea`、`secondaryInput`、`counter`、`primaryButton`、`primaryButtonDisabled`、`secondaryButton`、`successBanner`、`errorBanner`、`turnstileWrap`。未传的键使用包内默认（玻璃拟态 + 渐变按钮）。

### `WindChimeRateLimit`

- `max`：窗口内允许次数（默认 `3`）
- `windowMs`：窗口长度毫秒（默认 `60000`）
- `storageKey`：`localStorage` 键（默认 `windchime:rl`），多实例风铃请使用不同键

---

## `WindChimeAdminPanel` 属性说明

| 属性 | 类型 | 说明 |
|------|------|------|
| `items` | `WindChimeMessageRecord[]` | **必填**。当前要展示的留言列表。 |
| `isLoading` | `boolean` | 为真时禁用刷新按钮并显示「加载中…」 |
| `error` | `string \| null` | 顶部错误条（如列表加载失败） |
| `title` / `emptyText` | `ReactNode` / `string` | 标题与空状态 |
| `onReload` | `() => void` | 提供则显示「刷新」 |
| `onDelete` | `(id: string) => Promise<void>` | 提供则每行显示删除；内部使用 `window.confirm`（文案为中文） |
| `onExportCsv` | `() => void` | 若传入则点击「导出 CSV」时**只**调用该回调；不传则使用内置逻辑导出当前 `items` 为 CSV 文件 |
| `theme` | `WindChimeAdminTheme` | 工具栏、表格等 class 覆盖 |
| `className` | `string` | 根容器 |

### `WindChimeMessageRecord`

与后端约定一致即可对接：`id`、`createdAt`（ISO 字符串）、`text`、`nickname?`、`linkUrl?`。

---

## `WindChimeFloatingButton`

固定在角落的 🎐 浮动按钮，点击展开 `WindChimeSender` 弹窗。自带「禁用态」：风铃关闭时按钮会灰化，弹窗顶部展示横幅提示，Sender 整体置灰并拦截提交。

开关来源二选一：

- **受控**：传 `enabled: boolean | null`（`null` 视为加载中）。
- **自动轮询**：传 `settingsUrl`，组件每 `pollIntervalMs`（默认 30 秒）`GET` 一次，期待响应为 `{ enabled: boolean }`。

```tsx
'use client';
import { WindChimeFloatingButton } from '@windchime/embed';

<WindChimeFloatingButton
  onSubmit={async (payload) => {
    const r = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(await r.text());
  }}
  settingsUrl="/api/settings"
  position="bottom-left"
  disabledBannerText="🎐 风铃暂时关闭，下次再来吧 ~"
  senderProps={{ collectNickname: true, collectLinkUrl: true }}
/>
```

主要 props：

| 属性 | 类型 | 默认 / 说明 |
|------|------|----------|
| `onSubmit` | `(payload) => Promise<void>` | **必填**。关闭时组件会报 `disabledMessage`。 |
| `enabled` | `boolean \| null` | 受控模式。与 `settingsUrl` 二选一。 |
| `settingsUrl` | `string` | 自动轮询模式。 |
| `pollIntervalMs` | `number` | `30000` |
| `disabledMessage` / `disabledBannerText` | `string / ReactNode` | 禁用提示 |
| `icon` | `ReactNode` | 默认 🎐 |
| `position` | `'bottom-left' \| 'bottom-right' \| 'top-left' \| 'top-right'` | `'bottom-left'` |
| `enableSway` / `swayIntervalMs` | `boolean / number` | 摇曳动画开关与间隔（默认 6s） |
| `senderProps` | `Omit<WindChimeSenderProps, 'onSubmit'>` | 透传弹窗内 `WindChimeSender` 的配置 |
| `theme` | `WindChimeFloatingButtonTheme` | 按钮/遮罩/弹窗/禁用横幅的 class 覆盖 |

### 服务端「开关」实现参考

示例项目 `examples/next-sqlite` 给出了完整端到端方案：

- `windchime_settings(key, value, updated_at)` 表 + `getBoolSetting/setBoolSetting/WINDCHIME_ENABLED_KEY` 工具函数。
- `app/api/settings/route.ts`：`GET` 返回 `{ enabled }`；`PUT` 写入（生产需加管理员鉴权）。
- `app/api/messages/route.ts` 的 `POST` 在关闭时直接返回 **423 Locked**（客户端被绕过时的部分防护）。

---

## `WindChimeQrPosterEditor`

小表单，用来调 `WindChimeQrCard` 海报模式的文案。

```tsx
'use client';
import { useState } from 'react';
import {
  DEFAULT_POSTER_CONFIG,
  WindChimeQrCard,
  WindChimeQrPosterEditor,
} from '@windchime/embed';
import type { WindChimeQrPosterConfig } from '@windchime/embed';

export function ShareTools({ pageUrl }: { pageUrl: string }) {
  const [poster, setPoster] = useState<WindChimeQrPosterConfig>(() => ({
    ...DEFAULT_POSTER_CONFIG,
    heading: '扫码给我留言',
    body: '匿名也可以哦 ~',
  }));

  return (
    <>
      <WindChimeQrCard
        url={pageUrl}
        title="扫码给我挂风铃"
        poster={{ enabled: true, ...poster, footer: poster.footer || pageUrl }}
      />
      <WindChimeQrPosterEditor
        value={poster}
        onChange={setPoster}
        storageKey="my-site:poster"
      />
    </>
  );
}
```

传了 `storageKey` 后，组件会在首次挂载时回读 localStorage，变更后自动写回，父组件不需额外送到后端。

---

## `TurnstileWidget`（进阶）

若要在 Sender 之外单独嵌入 Turnstile，可使用导出的 `TurnstileWidget`（需传入 `siteKey`、`onToken` 等）。一般情况请直接使用 `WindChimeSender` 的 `turnstileSiteKey`。

---

## 0.4.0 新组件速览

> 以下组件**不**发网络请求（除非你走"拉取模式"），不绑定任何具体后端；每个都提供受控 + 可选拉取两种模式。

### `WindChimeFlaggedPanel` —「待审核」留言面板

```tsx
'use client';
import { WindChimeFlaggedPanel } from '@windchime/embed';

<WindChimeFlaggedPanel
  items={messages}                                // 全量列表；组件内部 filter((m) => m.isFlagged)
  onLoadDetail={async (id) => {                   // 打开 modal 时懒加载原文
    const r = await fetch(`/api/mail/messages/${id}`, { headers: auth });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }}
  onMarkRead={async (id) => { /* PATCH isRead:true */ }}
  onDelete={async (id)   => { /* DELETE */ }}
  onBlockSender={async (id) => { /* POST .../block */ }}
  onAfterAction={() => void reload()}
/>
```

### `WindChimeBlockedTermsPanel` — 敏感词配置

```tsx
// 受控模式（推荐）
<WindChimeBlockedTermsPanel
  terms={terms}                                   // string[]
  onSave={async (next) => {                       // next 已自动去重 + lowercase
    await fetch('/api/mail/blocked-terms', { method: 'PUT', body: JSON.stringify({ terms: next }) });
    setTerms(next);
  }}
/>

// 拉取模式
<WindChimeBlockedTermsPanel
  endpoint="/api/mail/blocked-terms"
  requestHeaders={{ 'x-admin-password': pwd }}
  onUnauthorized={() => logout()}
/>
```

### Mail Topics 子系统

```tsx
import {
  WindChimeTopicTabs,
  WindChimeNewTopicModal,
  WindChimeArchiveConfirmModal,
  WindChimeArchivedTopicsDrawer,
  WindChimeTopicStatePage,
  WindChimeActiveTopicsBanner,
  type WindChimeTopic,
} from '@windchime/embed';

// 管理端：主 Tab 栏
<WindChimeTopicTabs
  topics={topics}
  activeTopicId={activeId}
  onSwitch={setActiveId}
  onOpenNewTopic={() => setShowNewModal(true)}
  onOpenArchivedDrawer={() => setShowArchive(true)}
  onOpenGlobalSettings={() => scrollToSettings()}
  onQuickArchive={(id) => handleArchive(topics.find(t => t.id === id)!)}
/>

// 新建主题（slug 正则 + 保留字 + 时间窗校验全内置）
<WindChimeNewTopicModal
  open={showNewModal}
  onClose={() => setShowNewModal(false)}
  endpoint="/api/mail/topics"
  requestHeaders={{ 'x-admin-password': pwd }}
  onCreated={(topic) => setTopics(xs => [...xs, topic])}
/>

// 首页 <body> 顶部
<WindChimeActiveTopicsBanner
  topics={siteConfig.activeTopics}                // 也可改用 endpoint="/api/mail/topics"
  linkPrefix="/m"
  linkAs={NextLink}                               // 接 next/link 拿 prefetch
/>

// /m/[slug]/page.tsx 服务端判断到非 active 时
<WindChimeTopicStatePage
  variant="scheduled"
  topicTitle={topic.title}
  topicDescription={topic.description}
  startsAt={topic.startsAt}
  linkAs={NextLink}
  footer="YOURSITE · MAIL_TOPICS"
/>
```

### `WindChimeSpeedDial`

```tsx
<WindChimeSpeedDial
  position="bottom-left"
  items={[
    {
      key: 'mail',
      icon: <MailIcon className="h-6 w-6" />,
      label: '发信箱',
      hint: '匿名投信',
      disabled: !mailEnabled,
      disabledHint: '发信箱暂时关闭',
      onClick: () => setMailOpen(true),
    },
    {
      key: 'gacha',
      icon: <GachaIcon className="h-6 w-6" />,
      label: '扭蛋机',
      hint: '随机一张表情包',
      onClick: () => setGachaOpen(true),
    },
  ]}
/>
```

---

## 安全与上线检查清单

1. **服务端校验 Turnstile**  
   前端 `turnstileToken` 必须用 Cloudflare 密钥在服务端调用 [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)，通过后再写入数据库。

2. **限流与防刷**  
   `rateLimit` 仅存在用户浏览器，清缓存或脚本即可绕过。请在 API 上按 IP / 用户 / 全局限流。

3. **敏感词与内容安全**  
   `blockedTerms` 仅为体验优化；正式环境应在服务端做词库、人工审核或第三方审核。

4. **管理端**  
   `WindChimeAdminPanel` 不包含登录。删除、列表接口必须放在 **已鉴权** 的管理路由后（Cookie Session、Bearer Token、内网等）。

5. **XSS**  
   列表中正文为纯文本展示；若你在扩展列中渲染 HTML，请自行消毒。

---

## 目录结构（开发）

```text
WindChime/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── styles/windchime.css
│   └── components/
│       ├── WindChimeSender.tsx
│       ├── WindChimeAdminPanel.tsx
│       └── TurnstileWidget.tsx
├── dist/                 # npm run build 产出，勿手改
├── examples/next-sqlite/ # Next.js + SQLite + Docker 示例
├── .dockerignore
└── README.md
```

---

## SQL 持久化与 Docker（1Panel）

仓库内 **`examples/next-sqlite`** 提供完整示例：

- Next.js App Router + **`better-sqlite3`** + REST 风格 `app/api/messages`；
- 生产镜像 **`examples/next-sqlite/Dockerfile`**（须在 **WindChime 仓库根** 执行 `docker build -f examples/next-sqlite/Dockerfile …`）；
- SQLite 目录可通过环境变量 **`WINDCHIME_DATA_DIR`** 指向挂卷路径（镜像默认 `/data`），适合 **1Panel Docker** 持久化。
- 附带 `/api/settings` + 「风铃开关」交互演示，作为 0.3.0 新特性的参考实现。

详细命令、Compose 与注意点见 **`examples/next-sqlite/README.md`**。

---

## 版本历史

### 0.4.0

> 一批通用 UI 回灌——把实际业务项目里打磨过的审核 / 敏感词 / 多主题收件箱能力沉淀进上游包，方便其他项目直接开箱用。

**审核 & 敏感词**
- 新增 `WindChimeFlaggedPanel`：默认只列发送者 + 时间，点「查看原文」才弹 modal 展开完整内容（`createPortal`），带「标已读 / 拉黑 / 删除」三个可选回调；配 `onLoadDetail` 懒加载详情。
- 新增 `WindChimeBlockedTermsPanel`：大文本框 + 保存按钮，支持**受控**（`terms + onSave`）与**拉取**（`endpoint + requestHeaders`）两种模式；自动 split / trim / lowercase / 去重。
- `WindChimeMessageRecord` 新增可选 `isFlagged: boolean`；`WindChimeInboxFilter` 新增 `'flagged'`；`WindChimeAdminPanel` 新增「待审核」tab，**命中审核旗标的消息只在该 tab 显示**，默认 `all / unread / favorited` 会自动过滤掉它们，防止直播切后台时糊脸。

**Mail Topics（多主题收件箱）**
- 新增类型模块 `types-topics`：`WindChimeTopic` / `WindChimeTopicState` / `WindChimeTopicListResponse` / `WindChimeTopicArchiveResponse` / `WindChimeTopicCreateInput` / `WindChimeTopicPatchInput` + `windChimeTopicStateLabel` / `isWindChimeTopicOpenNow` 辅助函数。
- 新增常量：`WIND_CHIME_TOPIC_SLUG_REGEX`（`^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$`）、`WIND_CHIME_TOPIC_RESERVED_SLUGS`（`default / new / admin / api / m`）。
- 新增 `WindChimeTopicTabs`：tab 按 `default → active → scheduled → ended` 分组排序；未读 badge、状态染色、已结束 tab 带「待归档」快捷按钮；末尾 ≥3 个已结束时提示一键清理。
- 新增 `WindChimeNewTopicModal`：slug 正则 + 保留字客户端校验；默认勾选时间窗（+0/+7 天）；取消勾选弹"永久活动 ≈ 常规信箱平行版"二次确认；入库前自动把北京时间转成 UTC ISO Z 串。
- 新增 `WindChimeArchiveConfirmModal`：当主题还有未读 / 待审核留言时弹窗，三按钮（先 markRead 再归档 / 仍然归档 / 取消）。
- 新增 `WindChimeArchivedTopicsDrawer`：右侧滑出抽屉，搜索 title / slug + 一键恢复；支持受控或拉取模式。
- 新增 `WindChimeTopicStatePage`：访客端「已结束 / 暂停中 / 未开始 + 倒计时」通用提示页；内置三种默认图标（可覆盖）、倒计时自动每秒刷新、到点提示"刷新页面即可投信"。
- 新增 `WindChimeActiveTopicsBanner`：全站顶部活动横幅，0 条不渲染、1 条直跳 `/m/{slug}`、≥2 条跳 `/m`；内置 × 按钮 + `sessionStorage` signature（新活动出现会自动取消 dismiss）。

**Speed-Dial**
- 新增 `WindChimeSpeedDial`：主按钮（默认"+"）展开 N 个竖向子按钮；每个 item 可独立禁用（灰化 + 换 `disabledHint`）；`closeOnClick` 控制点击是否自动收起；支持 `bottom-left / bottom-right / top-left / top-right` 四个默认位置。

**时间 / 时区工具**
- 新增 `windChimeLocalToUtcIso(localInput, timeZone?)` / `windChimeUtcIsoToLocal(iso, timeZone?)` / `windChimeNowAsLocal(timeZone?)` / `windChimePlusDaysAsLocal(days, timeZone?)` / `windChimeFormatInTimeZone(iso, { timeZone?, locale?, withSeconds? })`。
- 默认时区 `WIND_CHIME_DEFAULT_TIME_ZONE = 'Asia/Shanghai'`；实现用 `Intl.DateTimeFormat` 反算偏移，支持任意 IANA 时区（含 DST，不再是写死 `+08:00`）。

**样式 / 兼容**
- 新增 `styles/windchime.css` 里的 `windchime-overlay-enter` / `windchime-modal-enter` / `windchime-drawer-enter` / `windchime-sheet-enter` / `windchime-dial-item-enter` 关键帧；新组件**一律用 CSS 动画**，不引入 `framer-motion`。
- 所有新组件**不依赖** `lucide-react`（默认图标均为内联 SVG，可通过 `icons` / `icon` prop 完全替换）、**不依赖** `next/link`（默认用 `<a>`，需要 `next/link` 时通过 `linkAs` prop 注入）。
- 所有新组件都接受 `theme` prop，空即用内置玻璃拟态默认样式；配套导出 `WindChimeFlaggedPanelTheme` / `WindChimeBlockedTermsPanelTheme` / `WindChimeTopicTabsTheme` / `WindChimeTopicStatePageTheme` / `WindChimeActiveTopicsBannerTheme` / `WindChimeNewTopicModalTheme` / `WindChimeArchiveConfirmModalTheme` / `WindChimeArchivedTopicsDrawerTheme` / `WindChimeSpeedDialTheme`。

### 0.3.0

- 新增 `WindChimeFloatingButton`：通用浮动按钮与禁用态弹窗。
- 新增 `WindChimeQrPosterEditor` + `DEFAULT_POSTER_CONFIG`：海报编辑器，可选 localStorage 持久化。
- 示例 `examples/next-sqlite` 补齐 `windchime_settings` 表、`/api/settings` 路由、`POST /api/messages` 在关闭时返回 423 Locked。

### 0.2.0

- `WindChimeQrCard` 增加海报模式与头像支持。
- Admin 面板卡片布局与主题扩展。

---

## 常见问题

**Q：页面没有样式 / 按钮巨大且无颜色**  
**A：** 检查 Tailwind `content` 是否包含 `…/WindChime/dist/**/*.js`（或源码路径），修改后重启 `next dev`。

**Q：`onSubmit` 里不抛错但想显示服务端错误**  
**A：** 在 `fetch` 非 2xx 时 `throw new Error(…)`，组件会捕获并显示 `errorBanner`。

**Q：能否在 Server Component 里直接写 `<WindChimeSender />`？**  
**A：** 不能。请放在 Client 子组件或带 `'use client'` 的页面中。

---

## 许可证

MIT（见 `package.json` 的 `license` 字段）。
