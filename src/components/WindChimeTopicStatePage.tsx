'use client';

import {
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { windChimeFormatInTimeZone, WIND_CHIME_DEFAULT_TIME_ZONE } from '../time';
import '../styles/windchime.css';

/**
 * 访客访问 `/m/{slug}` 时，主题非 `active` 状态下展示的通用提示页。
 *
 * 三种 variant：
 * - `ended`：时间窗已过 / 主题已归档 → 「活动已结束」
 * - `disabled`：主播手动关闭 → 「活动暂停中」
 * - `scheduled`：未到开始时间 → 「活动即将开始」+ 倒计时
 *
 * 方案建议：即便 `ended / disabled / scheduled / archived`，页面仍返回
 * **HTTP 200 + 友好提示**（避免失效外链变 404），并在 `<head>` 加
 * `<meta name="robots" content="noindex, nofollow">` 防搜索引擎长期收录。
 * 本组件只渲染 UI，`<meta>` 请宿主在 Next.js metadata 里自行处理。
 *
 * 可通过 `linkAs` 注入 `next/link` 等组件；默认用原生 `<a>`。
 */

function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export type WindChimeTopicStateVariant = 'ended' | 'disabled' | 'scheduled';

export type WindChimeTopicStatePageTheme = {
  root?: string;
  gridBackground?: string;
  glowBackground?: string;
  contentWrap?: string;
  iconWrap?: string;
  badge?: string;
  heading?: string;
  panel?: string;
  body?: string;
  description?: string;
  backButton?: string;
  footer?: string;
  countdownWrap?: string;
  countdownCell?: string;
  countdownValue?: string;
  countdownUnit?: string;
  countdownStarted?: string;
};

const DEFAULT_THEME: Required<WindChimeTopicStatePageTheme> = {
  root:
    'relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-white via-slate-50 to-slate-100 px-4 py-10 text-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-100',
  gridBackground: 'pointer-events-none absolute inset-0 opacity-20 dark:opacity-40',
  glowBackground:
    'pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-violet-400/10 blur-3xl dark:bg-violet-500/10',
  contentWrap: 'relative z-10 w-full max-w-xl text-center',
  iconWrap: 'mb-4 flex items-center justify-center',
  badge:
    'mb-2 font-mono text-[11px] tracking-[0.3em] text-violet-700/70 dark:text-violet-300/80',
  heading:
    'text-2xl font-bold tracking-wide text-slate-900 sm:text-3xl dark:text-white',
  panel:
    'mx-auto mt-6 max-w-md rounded-2xl border border-violet-300/30 bg-white/70 p-6 shadow-[0_10px_32px_rgba(139,92,246,0.08)] backdrop-blur-xl dark:border-violet-400/30 dark:bg-slate-900/60',
  body: 'text-sm leading-relaxed text-slate-700 dark:text-slate-200',
  description: 'mt-3 text-xs italic text-slate-500 dark:text-slate-400',
  backButton:
    'inline-flex items-center gap-2 rounded-lg border border-violet-400/60 bg-white px-5 py-2.5 text-sm text-violet-700 transition hover:bg-violet-50 dark:border-violet-400/60 dark:bg-slate-900/60 dark:text-violet-200 dark:hover:bg-violet-400/10',
  footer: 'mt-8 font-mono text-[11px] tracking-[0.2em] text-slate-400 dark:text-slate-500',
  countdownWrap: 'mt-4 grid grid-cols-4 gap-2',
  countdownCell:
    'rounded-lg border border-violet-300/40 bg-white/70 py-2 text-center shadow-sm dark:border-violet-400/30 dark:bg-slate-900/60',
  countdownValue:
    'text-xl font-bold tabular-nums text-violet-700 dark:text-violet-200',
  countdownUnit: 'mt-0.5 font-mono text-[10px] text-slate-500 dark:text-slate-400',
  countdownStarted:
    'mt-4 rounded-lg border border-emerald-400/50 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/50 dark:bg-emerald-500/10 dark:text-emerald-200',
};

function mergeTheme(
  t?: WindChimeTopicStatePageTheme,
): Required<WindChimeTopicStatePageTheme> {
  return { ...DEFAULT_THEME, ...(t ?? {}) };
}

/** 注入的 Link 组件（如 `next/link`）的最小接口 */
type LinkLikeProps = {
  href: string;
  className?: string;
  children?: ReactNode;
};

export type WindChimeTopicStatePageProps = {
  variant: WindChimeTopicStateVariant;
  topicTitle: string;
  topicDescription?: string | null;
  /** `scheduled` 必传，ISO Z 串 */
  startsAt?: string | null;
  /** `ended` 时可选，ISO Z 串 */
  endsAt?: string | null;

  /** 返回列表页的路径；默认 `/m` */
  backHref?: string;
  /** 返回按钮文案，默认「返回活动列表」 */
  backLabel?: ReactNode;

  /** 自定义返回按钮图标（默认是一个内联 SVG 箭头） */
  backIcon?: ReactNode;
  /** 自定义各 variant 的图标（覆盖默认） */
  icons?: {
    ended?: ReactNode;
    disabled?: ReactNode;
    scheduled?: ReactNode;
  };
  /** 各 variant 的文案覆盖 */
  copy?: {
    ended?: { badge?: string; heading?: string; body?: (ctx: { topicTitle: string; endsAt?: string | null; formatTime: (iso: string) => string }) => ReactNode };
    disabled?: { badge?: string; heading?: string; body?: (ctx: { topicTitle: string }) => ReactNode };
    scheduled?: { badge?: string; heading?: string; body?: (ctx: { topicTitle: string; startsAt?: string | null; formatTime: (iso: string) => string }) => ReactNode };
  };

  /** 时区（用于时间展示），默认 Asia/Shanghai */
  timeZone?: string;
  /** 语言 locale（用于时间展示），默认 `zh-CN` */
  locale?: string;

  /** 底部品牌水印，默认不显示 */
  footer?: ReactNode;

  /**
   * 自定义 Link 组件，便于接入 `next/link` 等路由库。
   * 签名：`(props: { href, className?, children }) => JSX`
   * 不传时用原生 `<a>`。
   */
  linkAs?: ComponentType<LinkLikeProps>;

  theme?: WindChimeTopicStatePageTheme;
  className?: string;
};

/** 三个 variant 的默认内联 SVG 图标（大小 56px） */
const DEFAULT_ICON_ENDED = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      width: 56,
      height: 56,
      color: '#8b5cf6',
      filter: 'drop-shadow(0 0 16px rgba(139,92,246,0.45))',
    }}
    aria-hidden
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="9 12 11 14 15 10" />
  </svg>
);

const DEFAULT_ICON_DISABLED = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      width: 56,
      height: 56,
      color: '#f59e0b',
      filter: 'drop-shadow(0 0 16px rgba(251,191,36,0.55))',
    }}
    aria-hidden
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="10" y1="9" x2="10" y2="15" />
    <line x1="14" y1="9" x2="14" y2="15" />
  </svg>
);

const DEFAULT_ICON_SCHEDULED = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      width: 56,
      height: 56,
      color: '#0891b2',
      filter: 'drop-shadow(0 0 16px rgba(8,145,178,0.5))',
    }}
    aria-hidden
  >
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <polyline points="12 14 12 17 14 18" />
  </svg>
);

const DEFAULT_BACK_ICON = (
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
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

function DefaultLink({ href, className, children }: LinkLikeProps) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

export function WindChimeTopicStatePage({
  variant,
  topicTitle,
  topicDescription,
  startsAt,
  endsAt,
  backHref = '/m',
  backLabel = '返回活动列表',
  backIcon = DEFAULT_BACK_ICON,
  icons,
  copy,
  timeZone = WIND_CHIME_DEFAULT_TIME_ZONE,
  locale = 'zh-CN',
  footer,
  linkAs,
  theme,
  className,
}: WindChimeTopicStatePageProps) {
  const th = mergeTheme(theme);
  const Link = linkAs ?? DefaultLink;

  const formatTime = (iso: string) =>
    windChimeFormatInTimeZone(iso, { timeZone, locale });

  const resolved = resolveCopy({
    variant,
    topicTitle,
    startsAt,
    endsAt,
    icons,
    copy,
    formatTime,
  });

  return (
    <main
      className={cn(th.root, className)}
      data-widget="windchime-topic-state-page"
      data-variant={variant}
    >
      {/* 网格背景 */}
      <div
        className={th.gridBackground}
        style={{
          backgroundImage:
            'linear-gradient(rgba(139,92,246,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.15) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
        aria-hidden
      />
      {/* 光斑 */}
      <div className={th.glowBackground} aria-hidden />

      <div className={th.contentWrap}>
        <div className={th.iconWrap}>{resolved.icon}</div>

        <div className={th.badge}>{resolved.badge}</div>
        <h1 className={th.heading}>{resolved.heading}</h1>

        <div className={th.panel}>
          <p className={th.body}>{resolved.body}</p>
          {topicDescription && (
            <p className={th.description}>「{topicDescription}」</p>
          )}
          {variant === 'scheduled' && startsAt && (
            <Countdown targetIso={startsAt} theme={th} />
          )}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={backHref} className={th.backButton}>
            {backIcon}
            {backLabel}
          </Link>
        </div>

        {footer && <div className={th.footer}>{footer}</div>}
      </div>
    </main>
  );
}

WindChimeTopicStatePage.displayName = 'WindChimeTopicStatePage';

function resolveCopy(args: {
  variant: WindChimeTopicStateVariant;
  topicTitle: string;
  startsAt?: string | null;
  endsAt?: string | null;
  icons?: WindChimeTopicStatePageProps['icons'];
  copy?: WindChimeTopicStatePageProps['copy'];
  formatTime: (iso: string) => string;
}): {
  icon: ReactNode;
  badge: string;
  heading: string;
  body: ReactNode;
} {
  const { variant, topicTitle, startsAt, endsAt, icons, copy, formatTime } = args;

  if (variant === 'ended') {
    const c = copy?.ended ?? {};
    return {
      icon: icons?.ended ?? DEFAULT_ICON_ENDED,
      badge: c.badge ?? 'EVENT · ENDED',
      heading: c.heading ?? '活动已结束',
      body:
        c.body?.({ topicTitle, endsAt, formatTime }) ??
        (endsAt
          ? `「${topicTitle}」已于 ${formatTime(endsAt)} 结束，感谢每一位留言的小伙伴。期待下次相遇 ~`
          : `「${topicTitle}」已结束，感谢每一位留言的小伙伴。期待下次相遇 ~`),
    };
  }
  if (variant === 'disabled') {
    const c = copy?.disabled ?? {};
    return {
      icon: icons?.disabled ?? DEFAULT_ICON_DISABLED,
      badge: c.badge ?? 'EVENT · PAUSED',
      heading: c.heading ?? '活动暂停中',
      body:
        c.body?.({ topicTitle }) ??
        `「${topicTitle}」暂时关闭了，主播稍后会重新开启。你可以晚一点再来看看 ~`,
    };
  }
  const c = copy?.scheduled ?? {};
  return {
    icon: icons?.scheduled ?? DEFAULT_ICON_SCHEDULED,
    badge: c.badge ?? 'EVENT · COMING SOON',
    heading: c.heading ?? '活动即将开始',
    body:
      c.body?.({ topicTitle, startsAt, formatTime }) ??
      (startsAt
        ? `「${topicTitle}」将于 ${formatTime(startsAt)} 开始，别忘了收藏这个链接 ~`
        : `「${topicTitle}」即将开始，敬请期待 ~`),
  };
}

/**
 * 倒计时（显示到开始时间还有多少天/时/分/秒）。到点后不会自动刷新页面——
 * 需访客手动刷新，由服务端重新 SSR 成 `active` 的投信页。
 */
function Countdown({
  targetIso,
  theme: th,
}: {
  targetIso: string;
  theme: Required<WindChimeTopicStatePageTheme>;
}) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const target = new Date(targetIso).getTime();
  const diff = Math.max(0, target - now);
  const sec = Math.floor(diff / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  if (diff === 0) {
    return (
      <div className={th.countdownStarted}>
        🎉 活动已经开始了！刷新页面即可投信 →
      </div>
    );
  }

  return (
    <div className={th.countdownWrap}>
      <TimeCell value={d} unit="天" theme={th} />
      <TimeCell value={h} unit="时" theme={th} />
      <TimeCell value={m} unit="分" theme={th} />
      <TimeCell value={s} unit="秒" theme={th} />
    </div>
  );
}

function TimeCell({
  value,
  unit,
  theme: th,
}: {
  value: number;
  unit: string;
  theme: Required<WindChimeTopicStatePageTheme>;
}) {
  return (
    <div className={th.countdownCell}>
      <div className={th.countdownValue}>
        {String(value).padStart(2, '0')}
      </div>
      <div className={th.countdownUnit}>{unit}</div>
    </div>
  );
}
