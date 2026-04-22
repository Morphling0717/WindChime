'use client';

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import '../styles/windchime.css';

/**
 * 角落收纳式 Speed-Dial：主按钮展开多个子按钮（竖向排列）。
 *
 * 典型用例：一个首页既要「匿名投信」也要「扭蛋机 / 捐助 / 联系」等入口，
 * 但不想在右下角堆 5 个浮动按钮。主按钮收纳态只占一个位置，展开后子按
 * 钮交错浮现（用 `windchime-dial-item-enter` CSS 动画）。
 *
 * 每个子按钮 `item` 可以独立禁用（`disabled` → 灰化 + `hint` 切到
 * `disabledHint`），点击主按钮或遮罩关闭。ESC 也可以收起。
 *
 * 本组件只负责 UI 与开合；**不包含任何业务弹窗**——子按钮的 `onClick`
 * 由宿主自己挂载自定义 Modal / Drawer。
 */

function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export type WindChimeSpeedDialItem = {
  /** 唯一 key */
  key: string;
  /** 子按钮里显示的图标（ReactNode，建议 24x24 SVG 或 emoji） */
  icon: ReactNode;
  /** 标签文字（显示在右侧的徽标上） */
  label: string;
  /** 副标题提示 */
  hint?: string;
  /** 禁用时展示的备用提示文案 */
  disabledHint?: string;
  /** 点击处理；`disabled=true` 时不触发 */
  onClick: () => void;
  /** 禁用态灰化 */
  disabled?: boolean;
  /** 点击后是否自动收起 Speed-Dial；默认 true */
  closeOnClick?: boolean;
};

export type WindChimeSpeedDialTheme = {
  root?: string;
  scrim?: string;
  mainButton?: string;
  mainButtonIcon?: string;
  itemsWrap?: string;
  itemRoot?: string;
  itemLabel?: string;
  itemLabelText?: string;
  itemLabelHint?: string;
  itemButton?: string;
  itemButtonDisabled?: string;
};

const DEFAULT_THEME: Required<WindChimeSpeedDialTheme> = {
  root: 'pointer-events-none fixed bottom-6 left-6 z-50 flex flex-col-reverse items-center gap-3',
  scrim: 'fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]',
  mainButton:
    'pointer-events-auto relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-violet-500 bg-white/90 text-violet-600 shadow-[0_8px_30px_rgba(139,92,246,0.25)] backdrop-blur-md transition-colors hover:bg-violet-500 hover:text-white dark:border-violet-400 dark:bg-slate-950/80 dark:text-violet-300 dark:hover:bg-violet-500 dark:hover:text-white',
  mainButtonIcon: 'block',
  itemsWrap:
    'pointer-events-auto flex flex-col-reverse items-center gap-3',
  itemRoot: 'relative flex items-center gap-3',
  itemLabel:
    'pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-md border border-violet-300/60 bg-white/90 px-3 py-1.5 font-mono text-xs text-violet-800 shadow-sm backdrop-blur-md dark:border-violet-400/40 dark:bg-slate-950/80 dark:text-violet-200',
  itemLabelText: 'font-bold',
  itemLabelHint: 'ml-2 text-slate-500 dark:text-slate-400',
  itemButton:
    'flex h-12 w-12 items-center justify-center rounded-full border-2 border-violet-500 bg-white/90 text-violet-600 shadow-[0_6px_20px_rgba(139,92,246,0.2)] backdrop-blur-md transition-colors hover:bg-violet-500 hover:text-white dark:border-violet-400 dark:bg-slate-950/80 dark:text-violet-300 dark:hover:bg-violet-500 dark:hover:text-white',
  itemButtonDisabled:
    'flex h-12 w-12 items-center justify-center rounded-full border-2 border-slate-400/60 bg-slate-200/70 text-slate-400 shadow-sm backdrop-blur-md cursor-not-allowed dark:border-slate-600/60 dark:bg-slate-800/60 dark:text-slate-500',
};

function mergeTheme(t?: WindChimeSpeedDialTheme): Required<WindChimeSpeedDialTheme> {
  return { ...DEFAULT_THEME, ...(t ?? {}) };
}

const DEFAULT_PLUS_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: 28, height: 28 }}
    aria-hidden
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export type WindChimeSpeedDialProps = {
  /** 子按钮（至少 1 个；3~4 个最佳） */
  items: WindChimeSpeedDialItem[];

  /** 主按钮图标（默认是一个"+"） */
  mainIcon?: ReactNode;
  /** 主按钮 aria-label */
  mainAriaLabel?: string;

  /** 是否禁用展开时遮罩；默认 false */
  disableScrim?: boolean;

  /** 固定位置（仅在用默认 theme 时生效；自定义 theme.root 会完全接管） */
  position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

  theme?: WindChimeSpeedDialTheme;
  className?: string;
};

const POSITION_CLASS: Record<NonNullable<WindChimeSpeedDialProps['position']>, string> = {
  'bottom-left': 'pointer-events-none fixed bottom-6 left-6 z-50 flex flex-col-reverse items-center gap-3',
  'bottom-right': 'pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col-reverse items-end gap-3',
  'top-left': 'pointer-events-none fixed top-6 left-6 z-50 flex flex-col items-center gap-3',
  'top-right': 'pointer-events-none fixed top-6 right-6 z-50 flex flex-col items-end gap-3',
};

export function WindChimeSpeedDial({
  items,
  mainIcon = DEFAULT_PLUS_ICON,
  mainAriaLabel = '展开菜单',
  disableScrim = false,
  position = 'bottom-left',
  theme,
  className,
}: WindChimeSpeedDialProps) {
  const th = useMemo(() => mergeTheme(theme), [theme]);
  const rootClass = theme?.root ?? POSITION_CLASS[position];
  const [expanded, setExpanded] = useState(false);

  // ESC 收起
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  return (
    <>
      <div className={cn(rootClass, className)} data-widget="windchime-speed-dial">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? '收起菜单' : mainAriaLabel}
          aria-expanded={expanded}
          className={th.mainButton}
        >
          <span
            className={th.mainButtonIcon}
            style={{
              display: 'inline-flex',
              transform: expanded ? 'rotate(45deg)' : 'rotate(0)',
              transition: 'transform 0.3s cubic-bezier(0.2, 0.8, 0.3, 1.1)',
            }}
            aria-hidden
          >
            {mainIcon}
          </span>
        </button>

        {expanded && (
          <div className={th.itemsWrap}>
            {items.map((item, i) => (
              <SpeedDialItemView
                key={item.key}
                item={item}
                index={i}
                th={th}
                onAfterClick={(closeOnClick) => {
                  if (closeOnClick) setExpanded(false);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {expanded && !disableScrim && (
        <div
          className={cn(th.scrim, 'windchime-overlay-enter')}
          onClick={() => setExpanded(false)}
        />
      )}
    </>
  );
}

WindChimeSpeedDial.displayName = 'WindChimeSpeedDial';

function SpeedDialItemView({
  item,
  index,
  th,
  onAfterClick,
}: {
  item: WindChimeSpeedDialItem;
  index: number;
  th: Required<WindChimeSpeedDialTheme>;
  onAfterClick: (closeOnClick: boolean) => void;
}) {
  const { icon, label, hint, disabledHint, onClick, disabled, closeOnClick = true } = item;

  const handleClick = () => {
    if (disabled) return;
    onClick();
    onAfterClick(closeOnClick);
  };

  const visibleHint = disabled ? (disabledHint ?? hint ?? '') : (hint ?? '');

  return (
    <div
      className={cn(th.itemRoot, 'windchime-dial-item-enter')}
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <span className={th.itemLabel}>
        <span className={th.itemLabelText}>{label}</span>
        {visibleHint && <span className={th.itemLabelHint}>{visibleHint}</span>}
      </span>
      <button
        type="button"
        onClick={handleClick}
        aria-label={`${label}${visibleHint ? ' · ' + visibleHint : ''}`}
        aria-disabled={disabled}
        className={disabled ? th.itemButtonDisabled : th.itemButton}
      >
        {icon}
      </button>
    </div>
  );
}
