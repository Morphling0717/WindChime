'use client';

import { useMemo, type ReactNode } from 'react';
import type { WindChimeTopic, WindChimeTopicState } from '../types-topics';
import '../styles/windchime.css';

/**
 * 主 Tab 栏：常规信箱 + 活动主题 + 固定动作按钮（往期 / 新建 / 全局设置）。
 *
 * - `flex-wrap` 布局，主题少时自然排布，多时换行；v1 不做折叠下拉
 * - 每个主题 tab：title + 未读 badge + 状态染色（进行中 / 未开始 / 已结束）
 * - `default` 永远在最左；之后按 `active → scheduled → ended` 分组；组内
 *   `sortOrder` 升序 + `createdAt` 倒序
 * - 归档主题**不进主 tab 栏**，通过「往期活动」按钮进抽屉
 * - "已结束"状态的 tab 右上角带「待归档」快捷图标，直接归档不进主题内部
 * - 末尾 ≥3 个"已结束"时提示一键归档
 *
 * 组件不持有 state，所有交互通过 props 回调向外透出。
 */

function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export type WindChimeTopicTabsTheme = {
  root?: string;
  topicTabBase?: string;
  /** 针对不同 state 的 tab 样式（active 时会叠加 topicTabActive） */
  topicTabActive?: string;
  topicTabDefault?: string;
  topicTabActiveState?: string;
  topicTabScheduled?: string;
  topicTabEnded?: string;
  unreadBadge?: string;
  stateLabel?: string;
  quickArchiveButton?: string;
  separator?: string;
  actionButton?: string;
  hintBanner?: string;
};

const DEFAULT_THEME: Required<WindChimeTopicTabsTheme> = {
  root: 'flex flex-wrap items-center gap-2',
  topicTabBase:
    'rounded-lg border px-3 py-2 text-xs font-bold tracking-wide transition',
  topicTabActive:
    'border-violet-500 bg-violet-500/15 text-violet-800 shadow-sm dark:border-violet-400 dark:bg-violet-400/15 dark:text-violet-100',
  topicTabDefault:
    'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800/60',
  topicTabActiveState:
    'border-emerald-400/60 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-400/50 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20',
  topicTabScheduled:
    'border-dashed border-cyan-400/60 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:border-cyan-400/50 dark:bg-cyan-500/5 dark:text-cyan-200 dark:hover:bg-cyan-500/15',
  topicTabEnded:
    'border-slate-400 bg-slate-100 text-slate-500 hover:bg-slate-200 dark:border-slate-600/60 dark:bg-slate-500/10 dark:text-slate-400 dark:hover:bg-slate-500/20',
  unreadBadge:
    'ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white',
  stateLabel: 'ml-1.5 text-[10px] opacity-70',
  quickArchiveButton:
    'absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-amber-400 bg-white text-[9px] text-amber-600 shadow-sm transition hover:bg-amber-400 hover:text-white dark:bg-slate-900 dark:text-amber-300',
  separator: 'mx-1 h-6 w-px bg-slate-300/60 dark:bg-violet-400/20',
  actionButton:
    'flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600 transition hover:border-violet-500 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-violet-400 dark:hover:bg-violet-400/10 dark:hover:text-violet-100',
  hintBanner:
    'ml-auto text-[11px] text-amber-600 dark:text-amber-300/80',
};

function mergeTheme(
  t?: WindChimeTopicTabsTheme,
): Required<WindChimeTopicTabsTheme> {
  return { ...DEFAULT_THEME, ...(t ?? {}) };
}

const DEFAULT_ARCHIVE_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: 14, height: 14 }}
    aria-hidden
  >
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

const DEFAULT_PLUS_ICON = (
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
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const DEFAULT_SETTINGS_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: 14, height: 14 }}
    aria-hidden
  >
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);

export type WindChimeTopicTabsLabels = {
  archive?: string;
  newTopic?: string;
  globalSettings?: string;
  stateActive?: string;
  stateScheduled?: string;
  stateEnded?: string;
  quickArchiveTooltip?: string;
  endedHint?: string;
};

const DEFAULT_LABELS: Required<WindChimeTopicTabsLabels> = {
  archive: '往期活动',
  newTopic: '新建主题',
  globalSettings: '全局设置',
  stateActive: '进行中',
  stateScheduled: '未开始',
  stateEnded: '已结束',
  quickArchiveTooltip: '一键归档该主题',
  endedHint: '有 {count} 个已结束的主题，建议逐个点击归档',
};

export type WindChimeTopicTabsProps = {
  topics: WindChimeTopic[];
  activeTopicId: string;
  onSwitch: (topicId: string) => void;
  onOpenArchivedDrawer?: () => void;
  onOpenNewTopic?: () => void;
  onOpenGlobalSettings?: () => void;
  /** 已结束 tab 上的快捷归档按钮（仅在提供时渲染） */
  onQuickArchive?: (topicId: string) => void;
  /** 自定义三个固定动作按钮的图标 */
  icons?: {
    archive?: ReactNode;
    newTopic?: ReactNode;
    globalSettings?: ReactNode;
  };
  labels?: WindChimeTopicTabsLabels;
  theme?: WindChimeTopicTabsTheme;
  className?: string;
};

export function WindChimeTopicTabs({
  topics,
  activeTopicId,
  onSwitch,
  onOpenArchivedDrawer,
  onOpenNewTopic,
  onOpenGlobalSettings,
  onQuickArchive,
  icons,
  labels,
  theme,
  className,
}: WindChimeTopicTabsProps) {
  const th = useMemo(() => mergeTheme(theme), [theme]);
  const L = { ...DEFAULT_LABELS, ...(labels ?? {}) };

  const visible = useMemo(() => {
    return [...topics]
      .filter((t) => t.state !== 'archived')
      .sort((a, b) => {
        const priority = (s: WindChimeTopicState) =>
          s === 'default' ? 0 : s === 'active' ? 1 : s === 'scheduled' ? 2 : 3;
        const pa = priority(a.state);
        const pb = priority(b.state);
        if (pa !== pb) return pa - pb;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [topics]);

  const endedCount = visible.filter((t) => t.state === 'ended').length;
  const archivedCount = topics.filter((t) => t.state === 'archived').length;

  return (
    <div className={cn(th.root, className)} data-widget="windchime-topic-tabs">
      {visible.map((t) => (
        <TopicTabButton
          key={t.id}
          topic={t}
          active={activeTopicId === t.id}
          onClick={() => onSwitch(t.id)}
          onQuickArchive={onQuickArchive}
          labels={L}
          theme={th}
        />
      ))}

      {(onOpenArchivedDrawer || onOpenNewTopic || onOpenGlobalSettings) && (
        <span className={th.separator} aria-hidden />
      )}

      {onOpenArchivedDrawer && (
        <button
          type="button"
          onClick={onOpenArchivedDrawer}
          className={th.actionButton}
        >
          {icons?.archive ?? DEFAULT_ARCHIVE_ICON}
          {L.archive}
          {archivedCount > 0 ? ` (${archivedCount})` : ''}
        </button>
      )}
      {onOpenNewTopic && (
        <button type="button" onClick={onOpenNewTopic} className={th.actionButton}>
          {icons?.newTopic ?? DEFAULT_PLUS_ICON}
          {L.newTopic}
        </button>
      )}
      {onOpenGlobalSettings && (
        <button
          type="button"
          onClick={onOpenGlobalSettings}
          className={th.actionButton}
        >
          {icons?.globalSettings ?? DEFAULT_SETTINGS_ICON}
          {L.globalSettings}
        </button>
      )}

      {endedCount >= 3 && (
        <div className={th.hintBanner}>
          ⚠ {L.endedHint.replace('{count}', String(endedCount))}
        </div>
      )}
    </div>
  );
}

WindChimeTopicTabs.displayName = 'WindChimeTopicTabs';

function TopicTabButton({
  topic,
  active,
  onClick,
  onQuickArchive,
  labels,
  theme: th,
}: {
  topic: WindChimeTopic;
  active: boolean;
  onClick: () => void;
  onQuickArchive?: (topicId: string) => void;
  labels: Required<WindChimeTopicTabsLabels>;
  theme: Required<WindChimeTopicTabsTheme>;
}) {
  const { title, unreadCount = 0, state } = topic;

  const stateClass =
    state === 'default'
      ? th.topicTabDefault
      : state === 'active'
        ? th.topicTabActiveState
        : state === 'scheduled'
          ? th.topicTabScheduled
          : /* ended */ th.topicTabEnded;

  const stateLabel =
    state === 'active'
      ? labels.stateActive
      : state === 'scheduled'
        ? labels.stateScheduled
        : state === 'ended'
          ? labels.stateEnded
          : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          th.topicTabBase,
          active ? th.topicTabActive : stateClass,
        )}
      >
        <span className="inline-block max-w-[180px] truncate align-middle">
          {title}
        </span>
        {stateLabel && <span className={th.stateLabel}>· {stateLabel}</span>}
        {unreadCount > 0 && (
          <span className={th.unreadBadge}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {state === 'ended' && onQuickArchive && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onQuickArchive(topic.id);
          }}
          title={labels.quickArchiveTooltip}
          aria-label={labels.quickArchiveTooltip}
          className={th.quickArchiveButton}
        >
          📁
        </button>
      )}
    </div>
  );
}
