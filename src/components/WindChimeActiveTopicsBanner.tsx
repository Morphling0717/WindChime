'use client';

import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { WindChimeTopic } from '../types-topics';
import '../styles/windchime.css';

/**
 * 主站顶部「活动进行中」公告条。
 *
 * 展示规则（约定）：
 * - 0 条活动 → 不渲染（DOM 不占位）
 * - 1 条活动 → `🎂 {title} · 活动进行中 →`，点击跳 `{linkPrefix}/{slug}`
 * - ≥2 条活动 → `🎉 N 个活动进行中 · 查看全部 →`，点击跳 `{listHref}`
 *
 * 数据源：
 * 1. **受控**：宿主直接传 `topics`（通常是 `/api/config.activeTopics` 已注入
 *    的派生字段 → 不另发请求，可防击穿 DB）
 * 2. **拉取**：宿主传 `endpoint`（GET 返回 `{ items: WindChimeTopic[] }`），
 *    组件挂载时请求一次；宿主端可进一步过滤 `is_enabled_now=true` 的项。
 *
 * 关闭按钮：点击 × 后组件用 `sessionStorage` 记当前活动集合的 signature
 * （所有 slug 排序后拼接）。一旦主播新开活动 → signature 变 → 横幅再次
 * 出现；不会永久屏蔽新活动。
 */

function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

function signatureOf(topics: WindChimeTopic[]): string {
  return topics
    .map((t) => t.slug)
    .sort()
    .join('|');
}

export type WindChimeActiveTopicsBannerTheme = {
  root?: string;
  inner?: string;
  leftSpacer?: string;
  link?: string;
  icon?: string;
  label?: string;
  arrow?: string;
  dismissButton?: string;
};

const DEFAULT_THEME: Required<WindChimeActiveTopicsBannerTheme> = {
  root:
    'sticky top-0 right-0 left-0 z-40 border-b border-violet-200/60 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50 shadow-sm dark:border-violet-400/30 dark:from-violet-500/15 dark:via-slate-950/40 dark:to-fuchsia-500/15',
  inner: 'mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2 sm:gap-3 sm:py-2.5',
  leftSpacer: 'h-7 w-7 shrink-0',
  link:
    'flex min-w-0 flex-1 items-center justify-center gap-2 text-[12px] text-violet-800 transition hover:text-violet-900 sm:text-sm dark:text-violet-100 dark:hover:text-white',
  icon: 'h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300',
  label: 'truncate tracking-wide',
  arrow: 'shrink-0 text-violet-500 dark:text-violet-300',
  dismissButton:
    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-violet-500/80 transition hover:bg-white/70 hover:text-violet-900 dark:text-violet-200/70 dark:hover:bg-white/10 dark:hover:text-white',
};

function mergeTheme(
  t?: WindChimeActiveTopicsBannerTheme,
): Required<WindChimeActiveTopicsBannerTheme> {
  return { ...DEFAULT_THEME, ...(t ?? {}) };
}

type LinkLikeProps = {
  href: string;
  className?: string;
  children?: ReactNode;
};

function DefaultLink({ href, className, children }: LinkLikeProps) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

export type WindChimeActiveTopicsBannerProps = {
  /** 受控：直接提供当前有效主题列表（推荐） */
  topics?: WindChimeTopic[];

  /** 拉取模式：GET `{ items: WindChimeTopic[] }` */
  endpoint?: string;

  /** 单条活动时链接前缀（形成 `{prefix}/{slug}`），默认 `/m` */
  linkPrefix?: string;
  /** 多条活动时跳转的聚合列表页，默认 `/m` */
  listHref?: string;

  /** 单条活动模板：`{title}` 占位符 */
  singleLabelTemplate?: string;
  /** 多条活动模板：`{count}` 占位符 */
  multipleLabelTemplate?: string;

  /** 左侧图标（默认是内联闪光 SVG） */
  icon?: ReactNode;

  /** sessionStorage 键前缀；默认 `windchime:banner:dismissed` */
  dismissStorageKey?: string;

  /** Link 组件（注入 `next/link` 等） */
  linkAs?: ComponentType<LinkLikeProps>;

  theme?: WindChimeActiveTopicsBannerTheme;
  className?: string;
};

const DEFAULT_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: 16, height: 16 }}
    aria-hidden
  >
    <polygon points="12 2 15 9 22 10 17 15 18 22 12 18 6 22 7 15 2 10 9 9" />
  </svg>
);

const DEFAULT_CLOSE_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: 16, height: 16 }}
    aria-hidden
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export function WindChimeActiveTopicsBanner({
  topics: topicsProp,
  endpoint,
  linkPrefix = '/m',
  listHref = '/m',
  singleLabelTemplate = '{title} · 活动进行中',
  multipleLabelTemplate = '{count} 个活动进行中 · 查看全部',
  icon = DEFAULT_ICON,
  dismissStorageKey = 'windchime:banner:dismissed',
  linkAs,
  theme,
  className,
}: WindChimeActiveTopicsBannerProps) {
  const th = useMemo(() => mergeTheme(theme), [theme]);
  const Link = linkAs ?? DefaultLink;

  const [fetched, setFetched] = useState<WindChimeTopic[] | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);

  const isControlled = topicsProp !== undefined;

  // 拉取模式
  useEffect(() => {
    if (isControlled || !endpoint) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(endpoint, { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as { items?: WindChimeTopic[] };
        if (!cancelled) {
          setFetched(j.items ?? []);
        }
      } catch {
        /* 接口失败就当没活动，不阻塞页面渲染 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isControlled, endpoint]);

  const source = isControlled ? topicsProp! : fetched;
  // 二次保险：只展示未归档 + `isEnabledNow` 的项
  const topics = useMemo(
    () =>
      (source ?? []).filter((t) => !t.archivedAt && t.isEnabledNow && !t.isDefault),
    [source],
  );

  // 比对 sessionStorage signature 判断是否需要维持 dismissed 状态
  useEffect(() => {
    if (topics.length === 0) {
      setDismissed(false);
      return;
    }
    try {
      const saved = window.sessionStorage.getItem(dismissStorageKey);
      if (saved && saved === signatureOf(topics)) {
        setDismissed(true);
      } else {
        setDismissed(false);
      }
    } catch {
      /* 隐私模式等：忽略 */
    }
  }, [topics, dismissStorageKey]);

  if (source === null) return null; // 还在加载
  if (topics.length === 0 || dismissed) return null;

  const onDismiss = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDismissed(true);
    try {
      window.sessionStorage.setItem(dismissStorageKey, signatureOf(topics));
    } catch {
      /* noop */
    }
  };

  const single = topics.length === 1 ? topics[0] : null;
  const href = single ? `${linkPrefix}/${single.slug}` : listHref;
  const label = single
    ? singleLabelTemplate.replace('{title}', single.title)
    : multipleLabelTemplate.replace('{count}', String(topics.length));

  return (
    <div
      role="region"
      aria-label="活动公告"
      className={cn(th.root, className)}
      data-widget="windchime-active-topics-banner"
    >
      <div className={th.inner}>
        <div className={th.leftSpacer} aria-hidden />

        <Link href={href} className={th.link}>
          <span className={th.icon}>{icon}</span>
          <span className={th.label}>{label}</span>
          <span className={th.arrow} aria-hidden>
            →
          </span>
        </Link>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭活动公告"
          className={th.dismissButton}
        >
          {DEFAULT_CLOSE_ICON}
        </button>
      </div>
    </div>
  );
}

WindChimeActiveTopicsBanner.displayName = 'WindChimeActiveTopicsBanner';
