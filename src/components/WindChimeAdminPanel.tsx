'use client';

import { useCallback, useMemo, useState } from 'react';
import type {
  WindChimeAdminPanelProps,
  WindChimeAdminTheme,
  WindChimeInboxFilter,
  WindChimeMessageRecord,
} from '../types';

function cn(...parts: (string | undefined | false | null)[]) {
  return parts.filter(Boolean).join(' ');
}

const defaultAdminTheme: Required<WindChimeAdminTheme> = {
  root: 'w-full max-w-6xl text-slate-800 dark:text-slate-100',
  toolbar: 'mb-5 flex flex-wrap items-center gap-3',
  tabs: 'mb-6 inline-flex flex-wrap items-center gap-1.5 rounded-full border border-white/40 bg-white/30 p-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/40',
  tab: 'rounded-full px-5 py-2.5 text-[15px] font-semibold text-slate-600 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
  tabActive: 'bg-white text-violet-700 shadow-sm shadow-violet-500/10 dark:bg-slate-800 dark:text-violet-300',
  button:
    'rounded-2xl border border-slate-200/80 bg-white/60 px-5 py-2.5 text-[14px] font-semibold text-slate-700 shadow-[0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-md transition hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800',
  primaryButton:
    'rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(167,139,250,0.3)] transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
  dangerButton:
    'rounded-2xl border border-red-200/80 bg-red-50/80 px-5 py-2.5 text-[14px] font-semibold text-red-700 shadow-[0_2px_8px_rgba(248,113,113,0.15)] transition hover:bg-red-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200',
  rowSelected: 'ring-2 ring-violet-400/50 dark:ring-violet-500/40',
  tableWrap:
    'overflow-hidden rounded-3xl border border-white/40 bg-white/30 shadow-[0_8px_30px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/40',
  table: 'w-full min-w-[40rem] border-collapse text-left text-[15px]',
  th: 'border-b border-white/40 px-5 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-white/10 dark:text-slate-400',
  td: 'border-b border-white/20 px-5 py-4 align-top text-slate-700 transition hover:bg-white/40 dark:border-white/5 dark:text-slate-200 dark:hover:bg-slate-800/40',
  checkbox:
    'h-4 w-4 cursor-pointer rounded border-slate-300 text-violet-500 shadow-sm focus:ring-2 focus:ring-violet-400/40 dark:border-slate-600 dark:bg-slate-800',
  favoriteActive: 'text-amber-500',
  badge: 'inline-flex items-center rounded-full border border-stone-300/60 bg-stone-50/80 px-2 py-0.5 text-[11px] font-medium text-stone-600',
  link: 'text-violet-600 underline decoration-violet-400/40 underline-offset-2 hover:text-violet-500 dark:text-violet-300',
  muted: 'text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400',
  cardGrid: 'grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3',
  card: 'group relative flex flex-col overflow-hidden rounded-[2rem] border border-amber-200/60 bg-gradient-to-b from-[#fffaf4] to-[#fdf1e3] shadow-[0_12px_36px_-12px_rgba(120,80,40,0.22)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_48px_-12px_rgba(120,80,40,0.32)] dark:border-amber-100/30',
  cardUnread: 'ring-2 ring-violet-300/60 ring-offset-2 ring-offset-transparent',
  cardFavorited: 'border-amber-400/80 shadow-[0_12px_36px_-12px_rgba(217,119,6,0.35)]',
};

function mergeAdminTheme(t?: WindChimeAdminTheme): Required<WindChimeAdminTheme> {
  return {
    root: t?.root ?? defaultAdminTheme.root,
    toolbar: t?.toolbar ?? defaultAdminTheme.toolbar,
    tabs: t?.tabs ?? defaultAdminTheme.tabs,
    tab: t?.tab ?? defaultAdminTheme.tab,
    tabActive: t?.tabActive ?? defaultAdminTheme.tabActive,
    button: t?.button ?? defaultAdminTheme.button,
    primaryButton: t?.primaryButton ?? defaultAdminTheme.primaryButton,
    dangerButton: t?.dangerButton ?? defaultAdminTheme.dangerButton,
    rowSelected: t?.rowSelected ?? defaultAdminTheme.rowSelected,
    tableWrap: t?.tableWrap ?? defaultAdminTheme.tableWrap,
    table: t?.table ?? defaultAdminTheme.table,
    th: t?.th ?? defaultAdminTheme.th,
    td: t?.td ?? defaultAdminTheme.td,
    checkbox: t?.checkbox ?? defaultAdminTheme.checkbox,
    favoriteActive: t?.favoriteActive ?? defaultAdminTheme.favoriteActive,
    badge: t?.badge ?? defaultAdminTheme.badge,
    link: t?.link ?? defaultAdminTheme.link,
    muted: t?.muted ?? defaultAdminTheme.muted,
    cardGrid: t?.cardGrid ?? defaultAdminTheme.cardGrid,
    card: t?.card ?? defaultAdminTheme.card,
    cardUnread: t?.cardUnread ?? defaultAdminTheme.cardUnread,
    cardFavorited: t?.cardFavorited ?? defaultAdminTheme.cardFavorited,
  };
}

function toCsv(rows: WindChimeMessageRecord[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = ['id', 'createdAt', 'nickname', 'linkUrl', 'senderLabel', 'isRead', 'isFavorited', 'text']
    .map(esc)
    .join(',');
  const lines = rows.map((r) =>
    [
      r.id,
      r.createdAt,
      r.nickname ?? '',
      r.linkUrl ?? '',
      r.senderLabel ?? '',
      r.isRead ? '1' : '0',
      r.isFavorited ? '1' : '0',
      r.text,
    ]
      .map((c) => esc(String(c)))
      .join(','),
  );
  return [header, ...lines].join('\n');
}

const FILTER_META: { key: WindChimeInboxFilter; label: string }[] = [
  { key: 'all', label: '全部信笺' },
  { key: 'unread', label: '未读' },
  { key: 'favorited', label: '红心收藏' },
];

function applyFilter(rows: WindChimeMessageRecord[], f: WindChimeInboxFilter) {
  if (f === 'all') return rows;
  if (f === 'unread') return rows.filter((r) => !r.isRead);
  if (f === 'favorited') return rows.filter((r) => r.isFavorited);
  return rows;
}

function computeCounts(rows: WindChimeMessageRecord[]): Record<WindChimeInboxFilter, number> {
  let unread = 0;
  let favorited = 0;
  for (const r of rows) {
    if (!r.isRead) unread += 1;
    if (r.isFavorited) favorited += 1;
  }
  return { all: rows.length, unread, favorited };
}

export function WindChimeAdminPanel({
  items,
  isLoading,
  error,
  title = '风铃收件箱',
  emptyText = '暂无来信。',
  counts,
  filter,
  defaultFilter = 'all',
  onFilterChange,
  autoClientFilter = true,
  onReload,
  onDelete,
  onToggleRead,
  onToggleFavorite,
  onBlockSender,
  onBatchDelete,
  onBatchMarkRead,
  onExportCsv,
  theme,
  className,
}: WindChimeAdminPanelProps) {
  const th = useMemo(() => mergeAdminTheme(theme), [theme]);
  const isControlledFilter = filter !== undefined;
  const [innerFilter, setInnerFilter] = useState<WindChimeInboxFilter>(defaultFilter);
  const activeFilter = isControlledFilter ? (filter as WindChimeInboxFilter) : innerFilter;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<{ id: string; op: string } | null>(null);
  const [batchBusy, setBatchBusy] = useState<null | 'delete' | 'read'>(null);

  const visibleItems = useMemo(
    () =>
      isControlledFilter || !autoClientFilter
        ? items
        : applyFilter(items, activeFilter),
    [items, activeFilter, isControlledFilter, autoClientFilter],
  );

  const mergedCounts = useMemo<Record<WindChimeInboxFilter, number>>(() => {
    const auto = computeCounts(items);
    return {
      all: counts?.all ?? auto.all,
      unread: counts?.unread ?? auto.unread,
      favorited: counts?.favorited ?? auto.favorited,
    };
  }, [items, counts]);

  const visibleIds = useMemo(() => visibleItems.map((r) => r.id), [visibleItems]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  const setFilter = (f: WindChimeInboxFilter) => {
    if (!isControlledFilter) setInnerFilter(f);
    onFilterChange?.(f);
    setSelected(new Set());
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  };

  const run = useCallback(
    async (id: string, op: string, fn: () => Promise<void>) => {
      setBusy({ id, op });
      try {
        await fn();
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const handleExport = () => {
    if (onExportCsv) {
      onExportCsv();
      return;
    }
    const blob = new Blob([toCsv(visibleItems)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `windchime-messages-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = (id: string) => {
    if (!onDelete) return;
    if (!window.confirm('删除这条留言？')) return;
    void run(id, 'delete', () => onDelete(id));
  };

  const handleToggleRead = (row: WindChimeMessageRecord) => {
    if (!onToggleRead) return;
    void run(row.id, 'read', () => onToggleRead(row.id, !row.isRead));
  };

  const handleToggleFav = (row: WindChimeMessageRecord) => {
    if (!onToggleFavorite) return;
    void run(row.id, 'fav', () => onToggleFavorite(row.id, !row.isFavorited));
  };

  const handleBlock = (row: WindChimeMessageRecord) => {
    if (!onBlockSender) return;
    const who = row.senderLabel ? `「${row.senderLabel}」` : '该发送者';
    if (!window.confirm(`拉黑${who}？未来来自该设备的留言将被直接丢弃。`)) return;
    void run(row.id, 'block', () => onBlockSender(row.id));
  };

  const handleBatchDelete = async () => {
    if (!onBatchDelete || !someSelected) return;
    const ids = Array.from(selected);
    if (!window.confirm(`批量删除 ${ids.length} 条留言？`)) return;
    setBatchBusy('delete');
    try {
      await onBatchDelete(ids);
      setSelected(new Set());
    } finally {
      setBatchBusy(null);
    }
  };

  const handleBatchMarkRead = async () => {
    if (!onBatchMarkRead || !someSelected) return;
    const ids = Array.from(selected);
    setBatchBusy('read');
    try {
      await onBatchMarkRead(ids);
      setSelected(new Set());
    } finally {
      setBatchBusy(null);
    }
  };

  const showCheckbox = Boolean(onBatchDelete || onBatchMarkRead);

  return (
    <div className={cn(th.root, className)} data-widget="windchime-admin">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="bg-gradient-to-br from-violet-600 to-fuchsia-600 bg-clip-text text-2xl font-bold tracking-tight text-transparent dark:from-violet-300 dark:to-fuchsia-300">
          {title}
        </h2>
        <div className={th.toolbar}>
          {onReload && (
            <button
              type="button"
              className={th.button}
              onClick={() => onReload()}
              disabled={!!isLoading}
            >
              {isLoading ? '加载中…' : '刷新'}
            </button>
          )}
          <button
            type="button"
            className={th.button}
            onClick={handleExport}
            disabled={visibleItems.length === 0}
          >
            导出 CSV
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className={th.tabs} role="tablist" aria-label="收件箱分类">
        {FILTER_META.map((f) => {
          const active = activeFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(th.tab, active && th.tabActive)}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="ml-1.5 text-xs opacity-70">{mergedCounts[f.key]}</span>
            </button>
          );
        })}
      </div>

      {/* Batch action bar */}
      {(onBatchDelete || onBatchMarkRead) && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <input
            type="checkbox"
            className={cn(th.checkbox, 'h-5 w-5 rounded-md')}
            aria-label="全选可见"
            checked={allSelected}
            onChange={toggleAllVisible}
            disabled={visibleIds.length === 0}
          />
          <span className={th.muted}>
            已选 {selected.size} / {visibleIds.length}
          </span>
          {onBatchMarkRead && (
            <button
              type="button"
              className={th.button}
              onClick={() => void handleBatchMarkRead()}
              disabled={!someSelected || batchBusy !== null}
            >
              {batchBusy === 'read' ? '处理中…' : '批量已读'}
            </button>
          )}
          {onBatchDelete && (
            <button
              type="button"
              className={th.dangerButton}
              onClick={() => void handleBatchDelete()}
              disabled={!someSelected || batchBusy !== null}
            >
              {batchBusy === 'delete' ? '删除中…' : '批量删除'}
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <p
          className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-900 dark:text-red-100"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* Card grid */}
      {visibleItems.length === 0 && !isLoading ? (
        <div className="flex min-h-[300px] items-center justify-center rounded-[2rem] border border-white/20 bg-white/10 backdrop-blur-md dark:border-white/5 dark:bg-slate-900/20">
          <p className={cn(th.muted, 'text-center text-[15px]')}>{emptyText}</p>
        </div>
      ) : (
        <div className={th.cardGrid}>
          {visibleItems.map((row) => {
            const isSelected = selected.has(row.id);
            const isBusy = busy?.id === row.id;
            const fmtTime = new Date(row.createdAt).toLocaleString('zh-CN', {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <article
                key={row.id}
                className={cn(
                  th.card,
                  !row.isRead && th.cardUnread,
                  row.isFavorited && th.cardFavorited,
                  isSelected && 'ring-2 ring-violet-500/70 ring-offset-2 ring-offset-transparent',
                )}
              >
                {/* 顶部色带：收藏态换暖色调 */}
                <div
                  aria-hidden
                  className={cn(
                    'h-1.5 w-full',
                    row.isFavorited
                      ? 'bg-gradient-to-r from-amber-300 via-amber-400 to-orange-400'
                      : 'bg-gradient-to-r from-violet-400 via-fuchsia-400 to-rose-300',
                  )}
                />

                {/* 选择框（仅启用批量时），放到角落不打扰信笺主体 */}
                {showCheckbox && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(row.id)}
                    aria-label="选中该条留言"
                    className="absolute left-3 top-4 z-10 h-4 w-4 cursor-pointer rounded border-amber-300 bg-white/90 text-violet-500 shadow-sm focus:ring-2 focus:ring-violet-400/40"
                  />
                )}

                {/* 信笺主体 */}
                <div className={cn('flex flex-1 flex-col px-6 pb-4 pt-5', showCheckbox && 'pl-10')}>
                  {/* 标题行 */}
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <h3 className="font-serif text-base font-semibold tracking-tight text-stone-800">
                      🎐 风铃来信
                    </h3>
                    <time className="shrink-0 font-serif text-xs text-stone-500">{fmtTime}</time>
                  </div>

                  {/* 元信息：昵称 · 发送者 · 未读 */}
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    {row.nickname?.trim() && (
                      <span className="font-serif text-sm text-stone-700">{row.nickname}</span>
                    )}
                    {row.senderLabel && (
                      <span className={th.badge}>
                        {row.senderLabel}
                      </span>
                    )}
                    {!row.isRead && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100/90 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                        未读
                      </span>
                    )}
                  </div>

                  {/* 装饰分隔 */}
                  <div aria-hidden className="mb-4 flex items-center gap-2">
                    <span className="h-px flex-1 bg-gradient-to-r from-transparent to-amber-300/50" />
                    <span className="text-xs text-amber-400/70">❀</span>
                    <span className="h-px flex-1 bg-gradient-to-l from-transparent to-amber-300/50" />
                  </div>

                  {/* 正文 —— 衬线体、可选中可复制 */}
                  <p className="flex-1 whitespace-pre-wrap break-words font-serif text-[15px] leading-[1.9] text-stone-800 selection:bg-violet-200/60">
                    {row.text}
                  </p>

                  {/* 链接 */}
                  {row.linkUrl && (
                    <a
                      className="mt-3 inline-block max-w-full truncate font-serif text-xs text-violet-700 underline decoration-violet-400/50 underline-offset-2 hover:text-violet-500"
                      href={row.linkUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      🔗 {row.linkUrl}
                    </a>
                  )}

                  {/* 页脚：水印 + 署名 */}
                  <div className="mt-5 flex items-end justify-between border-t border-dashed border-amber-200/70 pt-3">
                    <span className="font-serif text-[10px] uppercase tracking-[0.3em] text-amber-500/70">
                      WindChime
                    </span>
                    <span className="font-serif text-xs italic text-stone-500">— 来自风铃</span>
                  </div>
                </div>

                {/* 操作栏 —— 与信笺底色协调的米白条 */}
                {(onToggleFavorite || onToggleRead || onBlockSender || onDelete) && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-amber-200/60 bg-amber-50/50 px-5 py-2.5">
                    {onToggleFavorite && (
                      <button
                        type="button"
                        className={cn(
                          'text-lg leading-none transition hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50',
                          row.isFavorited ? 'text-amber-500' : 'text-stone-400 hover:text-amber-400',
                        )}
                        onClick={() => handleToggleFav(row)}
                        disabled={isBusy}
                        title={row.isFavorited ? '取消收藏' : '收藏'}
                      >
                        {row.isFavorited ? '★' : '☆'}
                      </button>
                    )}
                    {onToggleRead && (
                      <button
                        type="button"
                        className="rounded-lg border border-stone-300/70 bg-white/80 px-2.5 py-1 text-xs font-medium text-stone-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => handleToggleRead(row)}
                        disabled={isBusy}
                      >
                        {row.isRead ? '标未读' : '标已读'}
                      </button>
                    )}
                    {onBlockSender && (
                      <button
                        type="button"
                        className="rounded-lg border border-stone-300/70 bg-white/80 px-2.5 py-1 text-xs font-medium text-stone-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => handleBlock(row)}
                        disabled={isBusy}
                        title="将该发送者加入黑名单"
                      >
                        {isBusy && busy?.op === 'block' ? '…' : '拉黑'}
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        className="ml-auto rounded-lg border border-red-400/40 bg-red-50/80 px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => handleDelete(row.id)}
                        disabled={isBusy}
                      >
                        {isBusy && busy?.op === 'delete' ? '…' : '删除'}
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

WindChimeAdminPanel.displayName = 'WindChimeAdminPanel';
