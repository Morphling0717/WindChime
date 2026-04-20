'use client';

import { useMemo, useState } from 'react';
import type { WindChimeAdminTheme, WindChimeBlocklistPanelProps } from '../types';

function cn(...parts: (string | undefined | false | null)[]) {
  return parts.filter(Boolean).join(' ');
}

const fallback: Required<
  Pick<
    WindChimeAdminTheme,
    | 'root'
    | 'toolbar'
    | 'button'
    | 'dangerButton'
    | 'tableWrap'
    | 'table'
    | 'th'
    | 'td'
    | 'badge'
    | 'muted'
  >
> = {
  root: 'w-full max-w-6xl text-slate-800 dark:text-slate-100',
  toolbar: 'mb-5 flex flex-wrap items-center gap-3',
  button:
    'rounded-2xl border border-slate-200/80 bg-white/60 px-5 py-2.5 text-[14px] font-semibold text-slate-700 shadow-[0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-md transition hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800',
  dangerButton:
    'rounded-2xl border border-red-200/80 bg-red-50/80 px-5 py-2.5 text-[14px] font-semibold text-red-700 shadow-[0_2px_8px_rgba(248,113,113,0.15)] transition hover:bg-red-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200',
  tableWrap:
    'overflow-hidden rounded-3xl border border-white/40 bg-white/30 shadow-[0_8px_30px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/40',
  table: 'w-full min-w-[40rem] border-collapse text-left text-[15px]',
  th: 'border-b border-white/40 px-5 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-white/10 dark:text-slate-400',
  td: 'border-b border-white/20 px-5 py-4 align-top text-slate-700 transition hover:bg-white/40 dark:border-white/5 dark:text-slate-200 dark:hover:bg-slate-800/40',
  badge:
    'inline-flex items-center rounded-full border border-white/60 bg-white/50 px-2.5 py-0.5 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-slate-800/60 dark:text-slate-200',
  muted: 'text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400',
};

export function WindChimeBlocklistPanel({
  items,
  isLoading,
  error,
  title = '风铃黑名单',
  emptyText = '尚未拉黑任何发送者。',
  onReload,
  onUnblock,
  theme,
  className,
}: WindChimeBlocklistPanelProps) {
  const th = useMemo(
    () => ({
      root: theme?.root ?? fallback.root,
      toolbar: theme?.toolbar ?? fallback.toolbar,
      button: theme?.button ?? fallback.button,
      dangerButton: theme?.dangerButton ?? fallback.dangerButton,
      tableWrap: theme?.tableWrap ?? fallback.tableWrap,
      table: theme?.table ?? fallback.table,
      th: theme?.th ?? fallback.th,
      td: theme?.td ?? fallback.td,
      badge: theme?.badge ?? fallback.badge,
      muted: theme?.muted ?? fallback.muted,
    }),
    [theme],
  );
  const [busyHash, setBusyHash] = useState<string | null>(null);

  const handleUnblock = async (hash: string) => {
    if (!onUnblock) return;
    if (!window.confirm('解除对该发送者的拉黑？')) return;
    setBusyHash(hash);
    try {
      await onUnblock(hash);
    } finally {
      setBusyHash(null);
    }
  };

  return (
    <div className={cn(th.root, className)} data-widget="windchime-blocklist">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="bg-gradient-to-br from-slate-700 to-slate-400 bg-clip-text text-2xl font-bold tracking-tight text-transparent dark:from-slate-200 dark:to-slate-400">
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
        </div>
      </div>

      {error && (
        <p
          className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-900 dark:text-red-100"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className={th.tableWrap}>
        <table className={th.table}>
          <thead>
            <tr>
              <th className={th.th}>标签</th>
              <th className={th.th}>拉黑时间</th>
              <th className={th.th}>样例</th>
              {onUnblock && <th className={th.th} />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !isLoading ? (
              <tr>
                <td colSpan={onUnblock ? 4 : 3} className={cn(th.td, 'py-16 text-center')}>
                  <span className={cn(th.muted, 'text-[15px]')}>{emptyText}</span>
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.hash}>
                  <td className={th.td}>
                    <span className={th.badge} title={row.hash}>
                      {row.label ?? row.hash.slice(0, 8)}
                    </span>
                  </td>
                  <td className={cn(th.td, th.muted, 'whitespace-nowrap')}>
                    {new Date(row.blockedAt).toLocaleString()}
                  </td>
                  <td className={th.td}>
                    {row.sampleText ? (
                      <span className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-slate-600 dark:text-slate-300">
                        {row.sampleText}
                      </span>
                    ) : (
                      <span className={th.muted}>—</span>
                    )}
                  </td>
                  {onUnblock && (
                    <td className={th.td}>
                      <button
                        type="button"
                        className={th.button}
                        disabled={busyHash === row.hash}
                        onClick={() => void handleUnblock(row.hash)}
                      >
                        {busyHash === row.hash ? '…' : '解除拉黑'}
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

WindChimeBlocklistPanel.displayName = 'WindChimeBlocklistPanel';
