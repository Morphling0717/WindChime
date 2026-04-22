'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { WindChimeMessageRecord } from '../types';
import '../styles/windchime.css';

/**
 * 「待审核」面板：集中展示命中敏感词（`isFlagged=true`）的留言。
 *
 * 默认在列表里**只显示发送者标签 + 时间**，主播点「查看原文」才会在 modal
 * 里展开完整内容——避免直播过程中切后台时被敏感词糊脸。
 *
 * 组件自己**不发网络请求**；原文拉取 / 已读 / 删除 / 拉黑 都通过 props 回调
 * 交给宿主；宿主决定接口形状（REST / GraphQL / RPC 皆可）。
 *
 * 非受控 `open` 状态由组件内部管理，回调完成后会调用 `onAfterAction` 让
 * 宿主刷新列表。
 */

function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

function safeHost(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.hostname;
  } catch {
    return '';
  }
}

/**
 * 通过 `theme` 覆盖视觉。所有键可选，缺省走内置玻璃拟态 + 琉璃红色调。
 */
export type WindChimeFlaggedPanelTheme = {
  root?: string;
  panel?: string;
  header?: string;
  title?: string;
  caption?: string;
  list?: string;
  listItem?: string;
  senderLabel?: string;
  timestamp?: string;
  viewButton?: string;
  emptyText?: string;
  overlay?: string;
  modalWrap?: string;
  modalCloseButton?: string;
  modalBadge?: string;
  modalSenderLabel?: string;
  modalTimestamp?: string;
  modalContentBox?: string;
  modalLoading?: string;
  modalError?: string;
  modalNicknameLabel?: string;
  modalNicknameValue?: string;
  modalText?: string;
  modalLinkRow?: string;
  modalLink?: string;
  modalLinkNote?: string;
  modalActions?: string;
  buttonMarkRead?: string;
  buttonBlock?: string;
  buttonDelete?: string;
};

const DEFAULT_THEME: Required<WindChimeFlaggedPanelTheme> = {
  root: 'w-full text-slate-800 dark:text-slate-100',
  panel:
    'rounded-2xl border border-rose-300/50 bg-white/40 p-5 shadow-[0_4px_20px_rgba(244,63,94,0.08)] backdrop-blur-xl sm:p-6 dark:border-rose-400/30 dark:bg-slate-900/40',
  header: 'mb-4 flex items-baseline justify-between gap-3',
  title: 'text-sm font-bold tracking-wider text-rose-600 dark:text-rose-300',
  caption: 'mt-1 text-xs text-slate-500 dark:text-slate-400',
  list: 'divide-y divide-rose-300/20 dark:divide-rose-400/15',
  listItem: 'flex flex-wrap items-center justify-between gap-3 py-3',
  senderLabel: 'font-mono text-sm font-bold text-rose-600 dark:text-rose-200',
  timestamp: 'font-mono text-[11px] text-slate-500 dark:text-slate-400',
  viewButton:
    'rounded-lg border border-rose-300 bg-rose-50 px-4 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 hover:text-rose-900 dark:border-rose-400/60 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500 dark:hover:text-white',
  emptyText: 'py-8 text-center text-sm text-slate-500 dark:text-slate-400',
  overlay:
    'fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md',
  modalWrap:
    'relative w-full max-w-xl rounded-2xl border border-rose-300 bg-white p-6 shadow-[0_10px_40px_rgba(244,63,94,0.2)] dark:border-rose-400/60 dark:bg-slate-900',
  modalCloseButton:
    'absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-rose-300 bg-white/80 text-rose-600 transition hover:bg-rose-500 hover:text-white dark:border-rose-400/60 dark:bg-slate-900/80 dark:text-rose-300',
  modalBadge:
    'mb-1 font-mono text-[11px] tracking-widest text-rose-500/80 dark:text-rose-300/80',
  modalSenderLabel:
    'text-lg font-bold tracking-wide text-rose-700 dark:text-rose-200',
  modalTimestamp: 'mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400',
  modalContentBox:
    'mt-4 min-h-[120px] rounded-xl border border-rose-200 bg-rose-50/50 p-4 dark:border-rose-400/30 dark:bg-slate-800/60',
  modalLoading: 'py-6 text-center font-mono text-sm text-rose-500/70 dark:text-rose-300/70',
  modalError:
    'rounded border border-rose-400 bg-rose-50 px-3 py-2 font-mono text-xs text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300',
  modalNicknameLabel: 'font-mono text-xs text-slate-500 dark:text-slate-400',
  modalNicknameValue: 'text-slate-800 dark:text-slate-100',
  modalText:
    'whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800 dark:text-slate-100',
  modalLinkRow: 'mt-2 space-y-1 font-mono text-xs',
  modalLink:
    'group inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md border border-amber-400/60 bg-amber-50/70 px-2 py-1.5 text-amber-800 transition hover:border-amber-500 hover:bg-amber-100 dark:border-amber-400/50 dark:bg-amber-400/5 dark:text-amber-100 dark:hover:bg-amber-400/15',
  modalLinkNote:
    'text-[10px] leading-relaxed text-slate-500 dark:text-slate-400',
  modalActions: 'mt-5 flex flex-wrap items-center justify-end gap-2',
  buttonMarkRead:
    'rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 font-mono text-xs text-sky-700 transition hover:bg-sky-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-cyan-400/50 dark:bg-slate-900/60 dark:text-cyan-200 dark:hover:bg-cyan-400 dark:hover:text-black',
  buttonBlock:
    'rounded-lg border border-amber-400 bg-amber-50 px-3 py-1.5 font-mono text-xs text-amber-800 transition hover:bg-amber-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-400/60 dark:bg-slate-900/60 dark:text-amber-200 dark:hover:bg-amber-500 dark:hover:text-black',
  buttonDelete:
    'rounded-lg border border-rose-500 bg-rose-500 px-3 py-1.5 font-mono text-xs font-bold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-40',
};

function mergeTheme(t?: WindChimeFlaggedPanelTheme): Required<WindChimeFlaggedPanelTheme> {
  return {
    ...DEFAULT_THEME,
    ...(t ?? {}),
  };
}

/**
 * 服务器返回的原文详情；字段尽量贴合 `WindChimeMessageRecord`，但
 * `text` 这类敏感字段直到打开 modal 才会拉取，宿主的接口可以独立优化。
 */
export type WindChimeFlaggedDetail = {
  id: string;
  createdAt: string;
  text: string;
  nickname?: string | null;
  linkUrl?: string | null;
  senderLabel?: string | null;
  senderHash?: string | null;
};

export type WindChimeFlaggedPanelProps = {
  /** 全量列表（通常是宿主 admin 的 messages），组件内部 `filter((m) => m.isFlagged)` */
  items: WindChimeMessageRecord[];
  /** 自定义标题（例如接入方品牌里用「待审核 · FLAGGED」这类） */
  title?: ReactNode;
  /** 标题下方说明文字 */
  caption?: ReactNode;
  /** 空态文案 */
  emptyText?: ReactNode;
  /** 拉取原文（打开 modal 时调用），失败请抛出 `Error` */
  onLoadDetail: (id: string) => Promise<WindChimeFlaggedDetail>;
  /** 标为已读 */
  onMarkRead?: (id: string) => Promise<void>;
  /** 删除（软删即可，组件只负责发起） */
  onDelete?: (id: string) => Promise<void>;
  /** 拉黑发送者（跨主题永久） */
  onBlockSender?: (id: string) => Promise<void>;
  /** 任一操作成功后的统一通知；宿主借此刷新列表 */
  onAfterAction?: () => void;
  /** 删除二次确认文案（`window.confirm`）；传 `false` 跳过确认 */
  deleteConfirmMessage?: string | false;
  /** 拉黑二次确认文案（占位 `{label}` 会被替换为 `senderLabel`） */
  blockConfirmMessage?: string;
  /** 语言按钮文案 */
  labels?: {
    viewOriginal?: string;
    markRead?: string;
    block?: string;
    delete?: string;
    close?: string;
    loading?: string;
    nicknameLabel?: string;
    linkLabel?: string;
    linkExternalNote?: string;
    badge?: string;
    unknownSender?: string;
  };
  timeZone?: string;
  theme?: WindChimeFlaggedPanelTheme;
  className?: string;
};

const DEFAULT_LABELS = {
  viewOriginal: '查看原文 →',
  markRead: '标为已读',
  block: '拉黑发信人',
  delete: '删除',
  close: '关闭',
  loading: '加载中…',
  nicknameLabel: '称呼：',
  linkLabel: '链接：',
  linkExternalNote:
    '匿名访客填入，已强制 noopener / noreferrer 新窗口打开。点击前请确认域名，谨防钓鱼。',
  badge: 'FLAGGED · 待审核',
  unknownSender: 'Unknown',
};

export function WindChimeFlaggedPanel({
  items,
  title = '待审核留言',
  caption,
  emptyText = '当前无待审核留言',
  onLoadDetail,
  onMarkRead,
  onDelete,
  onBlockSender,
  onAfterAction,
  deleteConfirmMessage = '确认删除这条留言？此操作为软删除。',
  blockConfirmMessage = '拉黑这名发信人？TA 以后投信会被静默丢弃（跨主题）。',
  labels,
  timeZone = 'Asia/Shanghai',
  theme,
  className,
}: WindChimeFlaggedPanelProps) {
  const th = useMemo(() => mergeTheme(theme), [theme]);
  const L = { ...DEFAULT_LABELS, ...(labels ?? {}) };
  const flagged = useMemo(() => items.filter((m) => m.isFlagged), [items]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openData, setOpenData] = useState<WindChimeFlaggedDetail | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const closeModal = useCallback(() => {
    setOpenId(null);
    setOpenData(null);
    setOpenError(null);
  }, []);

  // 打开 modal 时懒加载原文
  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    setOpenLoading(true);
    setOpenError(null);
    setOpenData(null);
    (async () => {
      try {
        const data = await onLoadDetail(openId);
        if (!cancelled) setOpenData(data);
      } catch (e) {
        if (!cancelled) {
          setOpenError(e instanceof Error ? e.message : '加载失败');
        }
      } finally {
        if (!cancelled) setOpenLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openId, onLoadDetail]);

  // ESC 关闭
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !acting) closeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, closeModal, acting]);

  const runAction = useCallback(
    async (id: string, fn: () => Promise<void>) => {
      setActing(true);
      setOpenError(null);
      try {
        await fn();
        onAfterAction?.();
        closeModal();
      } catch (e) {
        setOpenError(e instanceof Error ? e.message : '操作失败');
      } finally {
        setActing(false);
      }
    },
    [onAfterAction, closeModal],
  );

  const handleMarkRead = () => {
    if (!openId || !onMarkRead) return;
    void runAction(openId, () => onMarkRead(openId));
  };

  const handleDelete = () => {
    if (!openId || !onDelete) return;
    if (deleteConfirmMessage !== false) {
      if (!window.confirm(deleteConfirmMessage)) return;
    }
    void runAction(openId, () => onDelete(openId));
  };

  const handleBlock = () => {
    if (!openId || !onBlockSender) return;
    const label = openData?.senderLabel ?? L.unknownSender;
    if (!window.confirm(blockConfirmMessage.replace('{label}', label))) return;
    void runAction(openId, () => onBlockSender(openId));
  };

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', {
      timeZone,
      hour12: false,
    });

  return (
    <div className={cn(th.root, className)} data-widget="windchime-flagged">
      <div className={th.panel}>
        <div className={th.header}>
          <div>
            <div className={th.title}>⚠ {typeof title === 'string' ? title : title}</div>
            <div className={th.caption}>
              {caption ?? (
                <>
                  共 {flagged.length} 条命中敏感词，默认只显示发信人与时间；
                  点击<span style={{ color: 'inherit' }}>「查看原文」</span>
                  才会弹出完整内容。
                </>
              )}
            </div>
          </div>
        </div>

        {flagged.length === 0 ? (
          <div className={th.emptyText}>{emptyText}</div>
        ) : (
          <ul className={th.list}>
            {flagged.map((m) => (
              <li key={m.id} className={th.listItem}>
                <div className="flex flex-col">
                  <span className={th.senderLabel}>
                    {m.senderLabel ?? L.unknownSender}
                  </span>
                  <span className={th.timestamp}>{fmtTime(m.createdAt)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenId(m.id)}
                  className={th.viewButton}
                >
                  {L.viewOriginal}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {typeof document !== 'undefined' &&
        openId &&
        createPortal(
          <div
            className={cn(th.overlay, 'windchime-overlay-enter')}
            onClick={() => !acting && closeModal()}
          >
            <div
              className={cn(th.modalWrap, 'windchime-modal-enter')}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => !acting && closeModal()}
                aria-label={L.close}
                className={th.modalCloseButton}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>

              <div className={th.modalBadge}>{L.badge}</div>
              <div className={th.modalSenderLabel}>
                {openData?.senderLabel ?? L.unknownSender}
              </div>
              {openData?.createdAt && (
                <div className={th.modalTimestamp}>
                  {fmtTime(openData.createdAt)}
                </div>
              )}

              <div className={th.modalContentBox}>
                {openLoading && (
                  <div className={th.modalLoading}>{L.loading}</div>
                )}
                {openError && <div className={th.modalError}>{openError}</div>}
                {openData && !openLoading && (
                  <div className="space-y-3">
                    {openData.nickname && (
                      <div className={th.modalNicknameLabel}>
                        {L.nicknameLabel}
                        <span className={th.modalNicknameValue}>
                          {openData.nickname}
                        </span>
                      </div>
                    )}
                    <div className={th.modalText}>{openData.text}</div>
                    {openData.linkUrl && (
                      <div className={th.modalLinkRow}>
                        <div style={{ opacity: 0.7 }}>{L.linkLabel}</div>
                        <a
                          href={openData.linkUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className={th.modalLink}
                        >
                          <span aria-hidden>⚠</span>
                          <span style={{ fontWeight: 700 }}>
                            {safeHost(openData.linkUrl) || '外站链接'}
                          </span>
                          <span style={{ wordBreak: 'break-all', opacity: 0.8 }}>
                            {openData.linkUrl}
                          </span>
                        </a>
                        <div className={th.modalLinkNote}>
                          {L.linkExternalNote}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className={th.modalActions}>
                {onMarkRead && (
                  <button
                    type="button"
                    onClick={handleMarkRead}
                    disabled={!openData || acting}
                    className={th.buttonMarkRead}
                  >
                    {L.markRead}
                  </button>
                )}
                {onBlockSender && (
                  <button
                    type="button"
                    onClick={handleBlock}
                    disabled={!openData || acting}
                    className={th.buttonBlock}
                  >
                    {L.block}
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={!openData || acting}
                    className={th.buttonDelete}
                  >
                    {L.delete}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

WindChimeFlaggedPanel.displayName = 'WindChimeFlaggedPanel';
