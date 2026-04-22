'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { WindChimeTopic } from '../types-topics';
import { WIND_CHIME_DEFAULT_TIME_ZONE, windChimeFormatInTimeZone } from '../time';
import '../styles/windchime.css';

/**
 * 往期活动抽屉：展示已归档主题，支持按 `title` / `slug` 搜索 + 一键恢复。
 *
 * 两种数据源：
 * 1. **受控**：宿主传 `items`（已归档主题数组）+ `onRestore(topic)`
 * 2. **拉取**：传 `listEndpoint`（GET 返回 `{ items: Topic[] }`，组件只
 *    过滤 `state === 'archived'`）+ `restoreEndpoint(topicId)`（PATCH 清
 *    空 `archivedAt` 返回 `WindChimeTopic`）
 *
 * 组件不实现"原位查看归档信件"——主播要看历史来信，先恢复到主 tab 栏再
 * 切入；抽屉里只提供轻量的恢复能力，避免堆功能。
 */

function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

async function readError(res: Response): Promise<string> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    return j?.error ?? res.statusText;
  }
  return (await res.text().catch(() => '')) || res.statusText;
}

export type WindChimeArchivedTopicsDrawerTheme = {
  overlay?: string;
  panel?: string;
  closeButton?: string;
  header?: string;
  headerTitle?: string;
  headerIcon?: string;
  headerCaption?: string;
  searchInput?: string;
  listWrap?: string;
  listEmpty?: string;
  listError?: string;
  listLoading?: string;
  item?: string;
  itemTitle?: string;
  itemSlug?: string;
  itemMeta?: string;
  restoreButton?: string;
};

const DEFAULT_THEME: Required<WindChimeArchivedTopicsDrawerTheme> = {
  overlay:
    'fixed inset-0 z-[1100] flex items-stretch justify-end bg-black/70 backdrop-blur-md',
  panel:
    'relative flex h-full w-full max-w-lg flex-col border-l border-violet-300/60 bg-white shadow-[-10px_0_40px_rgba(139,92,246,0.18)] dark:border-violet-400/40 dark:bg-slate-900',
  closeButton:
    'absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-violet-300 bg-white/80 text-violet-600 transition hover:bg-violet-500 hover:text-white dark:border-violet-400/60 dark:bg-slate-900/80 dark:text-violet-200',
  header: 'border-b border-violet-300/30 px-5 py-4 dark:border-violet-400/20',
  headerTitle:
    'text-sm font-bold tracking-wider text-violet-700 dark:text-violet-200',
  headerIcon: 'text-violet-500 dark:text-violet-300',
  headerCaption: 'mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400',
  searchInput:
    'mt-3 w-full rounded-lg border border-violet-300/60 bg-white/80 px-3 py-2 font-mono text-xs text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-400/20 dark:border-violet-400/30 dark:bg-slate-900/60 dark:text-slate-100',
  listWrap: 'flex-1 overflow-y-auto px-5 py-4',
  listEmpty: 'py-10 text-center font-mono text-sm text-slate-500 dark:text-slate-400',
  listError:
    'rounded border border-rose-400 bg-rose-50 px-3 py-2 font-mono text-xs text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300',
  listLoading: 'py-10 text-center font-mono text-sm text-violet-500/70 dark:text-violet-300/70',
  item: 'rounded-lg border border-slate-300/60 bg-slate-50/70 p-3 dark:border-slate-600/50 dark:bg-slate-500/5',
  itemTitle: 'truncate text-sm font-bold text-slate-800 dark:text-slate-200',
  itemSlug: 'mt-0.5 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400',
  itemMeta: 'mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400',
  restoreButton:
    'flex shrink-0 items-center gap-1 rounded-lg border border-violet-400 bg-violet-50 px-3 py-1.5 font-mono text-xs text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-400/60 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-400/20',
};

function mergeTheme(
  t?: WindChimeArchivedTopicsDrawerTheme,
): Required<WindChimeArchivedTopicsDrawerTheme> {
  return { ...DEFAULT_THEME, ...(t ?? {}) };
}

const DEFAULT_ARCHIVE_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: 18, height: 18 }}
    aria-hidden
  >
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

const DEFAULT_RESTORE_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: 13, height: 13 }}
    aria-hidden
  >
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
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
    style={{ width: 14, height: 14 }}
    aria-hidden
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export type WindChimeArchivedTopicsDrawerLabels = {
  close?: string;
  title?: string;
  caption?: string;
  searchPlaceholder?: string;
  loading?: string;
  empty?: string;
  noMatchTemplate?: string; // `{query}` 占位
  restore?: string;
  restoreFailed?: string;
  archivedAtPrefix?: string;
  activityRangePrefix?: string;
  slugPrefix?: string;
};

const DEFAULT_LABELS: Required<WindChimeArchivedTopicsDrawerLabels> = {
  close: '关闭',
  title: 'ARCHIVE · 往期活动',
  caption: '点「恢复」后主题会重新出现在主 tab 栏（状态按当前时间重新判定）',
  searchPlaceholder: '🔍 按标题 / slug 搜索…',
  loading: 'LOADING…',
  empty: 'EMPTY · 暂无归档主题',
  noMatchTemplate: 'NO MATCH · "{query}" 无匹配',
  restore: '恢复',
  restoreFailed: '恢复失败',
  archivedAtPrefix: '归档于',
  activityRangePrefix: '活动期:',
  slugPrefix: '/m/',
};

export type WindChimeArchivedTopicsDrawerProps = {
  open: boolean;
  onClose: () => void;
  onRestored: (topic: WindChimeTopic) => void;

  /** 受控：直接提供全部主题（组件内过滤 archived） */
  items?: WindChimeTopic[];
  /** 受控：执行恢复，返回恢复后的 Topic */
  onRestore?: (topic: WindChimeTopic) => Promise<WindChimeTopic>;

  /** 拉取模式：GET 全部主题（含归档）的端点，建议带 `?include=archived` */
  listEndpoint?: string;
  /** 拉取模式：给定 topicId 生成 PATCH 路径，默认 `${listEndpoint}/${id}` */
  restoreEndpointBuilder?: (topicId: string) => string;
  /** 拉取模式下的 admin 请求头 */
  requestHeaders?: Record<string, string>;

  timeZone?: string;

  labels?: WindChimeArchivedTopicsDrawerLabels;
  theme?: WindChimeArchivedTopicsDrawerTheme;

  /** 自定义图标 */
  icons?: {
    header?: ReactNode;
    restore?: ReactNode;
    close?: ReactNode;
  };
};

export function WindChimeArchivedTopicsDrawer({
  open,
  onClose,
  onRestored,
  items: itemsProp,
  onRestore,
  listEndpoint,
  restoreEndpointBuilder,
  requestHeaders,
  timeZone = WIND_CHIME_DEFAULT_TIME_ZONE,
  labels,
  theme,
  icons,
}: WindChimeArchivedTopicsDrawerProps) {
  const th = useMemo(() => mergeTheme(theme), [theme]);
  const L = { ...DEFAULT_LABELS, ...(labels ?? {}) };

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<WindChimeTopic[]>([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const isControlled = itemsProp !== undefined;

  const load = useCallback(async () => {
    if (!listEndpoint) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(listEndpoint, {
        headers: requestHeaders,
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(await readError(r));
      const j = (await r.json()) as { items: WindChimeTopic[] };
      setFetched(j.items.filter((t) => t.state === 'archived'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [listEndpoint, requestHeaders]);

  // 打开时拉（拉取模式）；关闭时清搜索
  useEffect(() => {
    if (open && !isControlled) void load();
    if (!open) setSearch('');
  }, [open, isControlled, load]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const archivedItems = useMemo(() => {
    if (isControlled) return (itemsProp ?? []).filter((t) => t.state === 'archived');
    return fetched;
  }, [isControlled, itemsProp, fetched]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return archivedItems;
    return archivedItems.filter(
      (t) =>
        t.title.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
    );
  }, [archivedItems, search]);

  const doRestore = useCallback(
    async (topic: WindChimeTopic) => {
      setBusyId(topic.id);
      try {
        let restored: WindChimeTopic;
        if (onRestore) {
          restored = await onRestore(topic);
        } else if (listEndpoint) {
          const url = restoreEndpointBuilder
            ? restoreEndpointBuilder(topic.id)
            : `${listEndpoint}/${encodeURIComponent(topic.id)}`;
          const r = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...(requestHeaders ?? {}) },
            body: JSON.stringify({ archivedAt: null }),
          });
          if (!r.ok) throw new Error(await readError(r));
          restored = (await r.json()) as WindChimeTopic;
        } else {
          throw new Error('未提供 onRestore / listEndpoint');
        }
        // 从拉取列表里移除这一条
        setFetched((xs) => xs.filter((x) => x.id !== topic.id));
        onRestored(restored);
      } catch (e) {
        alert(e instanceof Error ? e.message : L.restoreFailed);
      } finally {
        setBusyId(null);
      }
    },
    [onRestore, listEndpoint, requestHeaders, restoreEndpointBuilder, onRestored, L.restoreFailed],
  );

  if (typeof document === 'undefined') return null;
  if (!open) return null;

  return createPortal(
    <div
      className={cn(th.overlay, 'windchime-overlay-enter')}
      onClick={onClose}
    >
      <div
        className={cn(th.panel, 'windchime-drawer-enter')}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={L.close}
          className={th.closeButton}
        >
          {icons?.close ?? DEFAULT_CLOSE_ICON}
        </button>

        <div className={th.header}>
          <div className="flex items-center gap-2">
            <span className={th.headerIcon}>
              {icons?.header ?? DEFAULT_ARCHIVE_ICON}
            </span>
            <div className={th.headerTitle}>{L.title}</div>
          </div>
          <div className={th.headerCaption}>{L.caption}</div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={L.searchPlaceholder}
            className={th.searchInput}
          />
        </div>

        <div className={th.listWrap}>
          {loading && <div className={th.listLoading}>{L.loading}</div>}
          {error && <div className={th.listError}>{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div className={th.listEmpty}>
              {archivedItems.length === 0
                ? L.empty
                : L.noMatchTemplate.replace('{query}', search.trim())}
            </div>
          )}
          {!loading && !error && filtered.length > 0 && (
            <ul className="space-y-2">
              {filtered.map((t) => (
                <li key={t.id} className={th.item}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className={th.itemTitle}>{t.title}</div>
                      <div className={th.itemSlug}>
                        {L.slugPrefix}
                        {t.slug}
                      </div>
                      <div className={th.itemMeta}>
                        {L.archivedAtPrefix}{' '}
                        {windChimeFormatInTimeZone(t.archivedAt, { timeZone })}
                      </div>
                      {t.startsAt && t.endsAt && (
                        <div className={th.itemMeta}>
                          {L.activityRangePrefix}{' '}
                          {windChimeFormatInTimeZone(t.startsAt, { timeZone })} ~{' '}
                          {windChimeFormatInTimeZone(t.endsAt, { timeZone })}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busyId === t.id}
                      onClick={() => doRestore(t)}
                      className={th.restoreButton}
                    >
                      {icons?.restore ?? DEFAULT_RESTORE_ICON}
                      {busyId === t.id ? '…' : L.restore}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

WindChimeArchivedTopicsDrawer.displayName = 'WindChimeArchivedTopicsDrawer';
