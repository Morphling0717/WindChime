'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WindChimeTopic } from '../types-topics';
import '../styles/windchime.css';

/**
 * 归档前的二次确认。当主题还有未读 / 待审核留言时，让主播有机会：
 *
 * - 取消：放弃归档
 * - 先标已读再归档：宿主先批量 markRead 再 DELETE
 * - 仍然归档：直接 DELETE（未读信件保留，在「往期活动」抽屉仍可查看 /
 *   恢复）
 *
 * 组件读取 `topic.unreadCount` / `topic.flaggedCount` 来决定文案；两者都
 * 为 0 时宿主应当直接归档，不弹这个 modal。
 */

function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export type WindChimeArchiveConfirmModalTheme = {
  overlay?: string;
  wrap?: string;
  closeButton?: string;
  titleRow?: string;
  title?: string;
  prompt?: string;
  topicTitle?: string;
  unreadChip?: string;
  flaggedChip?: string;
  archiveKeyword?: string;
  buttonsWrap?: string;
  primaryAction?: string;
  primaryActionHeading?: string;
  primaryActionHint?: string;
  secondaryAction?: string;
  secondaryActionHeading?: string;
  secondaryActionHint?: string;
  cancelAction?: string;
  cancelActionHeading?: string;
  cancelActionHint?: string;
  busyHint?: string;
};

const DEFAULT_THEME: Required<WindChimeArchiveConfirmModalTheme> = {
  overlay:
    'fixed inset-0 z-[1150] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md',
  wrap:
    'relative w-full max-w-md rounded-2xl border border-amber-300 bg-white p-6 shadow-[0_10px_40px_rgba(251,191,36,0.25)] dark:border-amber-400/60 dark:bg-slate-900',
  closeButton:
    'absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-amber-300 bg-white/80 text-amber-700 transition hover:bg-amber-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-400/60 dark:bg-slate-900/80 dark:text-amber-300',
  titleRow: 'mb-2 flex items-center gap-2',
  title:
    'text-sm font-bold tracking-wider text-amber-700 dark:text-amber-200',
  prompt: 'mt-3 text-[14px] leading-relaxed text-amber-900 dark:text-amber-50',
  topicTitle: 'font-bold',
  unreadChip:
    'mx-1 rounded bg-rose-100 px-1.5 py-0.5 font-mono text-rose-700 dark:bg-rose-500/20 dark:text-rose-200',
  flaggedChip:
    'mx-1 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  archiveKeyword: 'mx-1 text-amber-700 dark:text-amber-200',
  buttonsWrap: 'mt-5 flex flex-col gap-2',
  primaryAction:
    'rounded-lg border border-sky-400 bg-sky-50 px-4 py-2.5 text-left text-xs text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-cyan-400/60 dark:bg-cyan-500/10 dark:text-cyan-100 dark:hover:bg-cyan-400/20',
  primaryActionHeading: 'font-bold text-sky-800 dark:text-cyan-200',
  primaryActionHint: 'mt-1 text-[11px] text-sky-600 dark:text-cyan-300/70',
  secondaryAction:
    'rounded-lg border border-amber-400 bg-amber-50 px-4 py-2.5 text-left text-xs text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-100 dark:hover:bg-amber-400/20',
  secondaryActionHeading: 'font-bold text-amber-800 dark:text-amber-200',
  secondaryActionHint: 'mt-1 text-[11px] text-amber-600 dark:text-amber-300/70',
  cancelAction:
    'rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-left text-xs text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/60',
  cancelActionHeading: 'font-bold text-slate-800 dark:text-slate-200',
  cancelActionHint: 'mt-1 text-[11px] text-slate-500 dark:text-slate-400',
  busyHint: 'mt-3 text-center font-mono text-[11px] text-sky-700/80 dark:text-cyan-300/80',
};

function mergeTheme(
  t?: WindChimeArchiveConfirmModalTheme,
): Required<WindChimeArchiveConfirmModalTheme> {
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
    style={{ width: 20, height: 20 }}
    aria-hidden
  >
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" />
    <line x1="10" y1="12" x2="14" y2="12" />
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

export type WindChimeArchiveConfirmModalLabels = {
  title?: string;
  close?: string;
  unread?: string;
  flagged?: string;
  archiveLink?: string;
  markReadFirstHeading?: string;
  markReadFirstHint?: string;
  archiveAnywayHeading?: string;
  archiveAnywayHint?: string;
  cancelHeading?: string;
  cancelHint?: string;
  busy?: string;
};

const DEFAULT_LABELS: Required<WindChimeArchiveConfirmModalLabels> = {
  title: 'CONFIRM · 归档前提醒',
  close: '关闭',
  unread: '未读',
  flagged: '待审核',
  archiveLink: '【往期活动】',
  markReadFirstHeading: '✓ 先标为已读再归档',
  markReadFirstHint: '所有未读先 markRead，然后归档（推荐）',
  archiveAnywayHeading: '⚡ 仍然归档',
  archiveAnywayHint: '未读状态保留；往期活动抽屉里还能看到',
  cancelHeading: '× 取消',
  cancelHint: '放弃归档，主题保持原状态',
  busy: '处理中…',
};

export type WindChimeArchiveConfirmModalProps = {
  open: boolean;
  topic: WindChimeTopic | null;
  onCancel: () => void;
  onMarkReadThenArchive: () => void;
  onArchiveAnyway: () => void;
  busy?: boolean;

  /** 自定义头部图标 */
  icon?: ReactNode;
  closeIcon?: ReactNode;

  labels?: WindChimeArchiveConfirmModalLabels;
  theme?: WindChimeArchiveConfirmModalTheme;
};

export function WindChimeArchiveConfirmModal({
  open,
  topic,
  onCancel,
  onMarkReadThenArchive,
  onArchiveAnyway,
  busy,
  icon = DEFAULT_ARCHIVE_ICON,
  closeIcon = DEFAULT_CLOSE_ICON,
  labels,
  theme,
}: WindChimeArchiveConfirmModalProps) {
  const th = useMemo(() => mergeTheme(theme), [theme]);
  const L = { ...DEFAULT_LABELS, ...(labels ?? {}) };

  // ESC 取消
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, busy]);

  if (typeof document === 'undefined') return null;
  if (!open || !topic) return null;

  const unread = topic.unreadCount ?? 0;
  const flagged = topic.flaggedCount ?? 0;

  return createPortal(
    <div
      className={cn(th.overlay, 'windchime-overlay-enter')}
      onClick={() => !busy && onCancel()}
    >
      <div
        className={cn(th.wrap, 'windchime-modal-enter')}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label={L.close}
          disabled={busy}
          className={th.closeButton}
        >
          {closeIcon}
        </button>

        <div className={th.titleRow}>
          <span style={{ color: 'currentColor' }}>{icon}</span>
          <div className={th.title}>{L.title}</div>
        </div>

        <p className={th.prompt}>
          <span className={th.topicTitle}>「{topic.title}」</span>
          还有
          {unread > 0 && (
            <span className={th.unreadChip}>
              {unread} 封{L.unread}
            </span>
          )}
          {unread > 0 && flagged > 0 && <span> / </span>}
          {flagged > 0 && (
            <span className={th.flaggedChip}>
              {flagged} 封{L.flagged}
            </span>
          )}
          ，归档后需去
          <strong className={th.archiveKeyword}>{L.archiveLink}</strong>
          才能查看。确定归档吗？
        </p>

        <div className={th.buttonsWrap}>
          <button
            type="button"
            onClick={onMarkReadThenArchive}
            disabled={busy}
            className={th.primaryAction}
          >
            <div className={th.primaryActionHeading}>{L.markReadFirstHeading}</div>
            <div className={th.primaryActionHint}>{L.markReadFirstHint}</div>
          </button>
          <button
            type="button"
            onClick={onArchiveAnyway}
            disabled={busy}
            className={th.secondaryAction}
          >
            <div className={th.secondaryActionHeading}>{L.archiveAnywayHeading}</div>
            <div className={th.secondaryActionHint}>{L.archiveAnywayHint}</div>
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={th.cancelAction}
          >
            <div className={th.cancelActionHeading}>{L.cancelHeading}</div>
            <div className={th.cancelActionHint}>{L.cancelHint}</div>
          </button>
        </div>

        {busy && <div className={th.busyHint}>{L.busy}</div>}
      </div>
    </div>,
    document.body,
  );
}

WindChimeArchiveConfirmModal.displayName = 'WindChimeArchiveConfirmModal';
