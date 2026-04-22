'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import '../styles/windchime.css';

/**
 * 「敏感词」管理面板：提供一个大文本框 + 保存按钮，便于主播 / 管理员在后台
 * 快速增删敏感词库。组件自己**不发网络请求**；两种使用模式：
 *
 * 1. **受控模式**（推荐）：宿主传 `terms` + `onSave`，组件只负责 UI
 *    - `terms` 为 DB 持久化的词库
 *    - `onSave(nextTerms)` 被点击「保存」时调用，宿主自行 PUT / PATCH
 *
 * 2. **拉取模式**：传 `endpoint`，组件内部 `GET endpoint` → 读 `{ terms: string[] }`，
 *    `PUT endpoint` 保存。请求时可带 `requestHeaders`（如 `{ 'x-admin-password': '...' }`）
 *    - 仅用于管理端内部 admin；**生产一定要做鉴权**
 *
 * 词库格式：
 * - 用户编辑时**逗号 / 换行**分隔；组件把字符串 split + trim + lowercase + 去重后返回
 * - 空字符串会被过滤掉
 */

function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export type WindChimeBlockedTermsPanelTheme = {
  root?: string;
  panel?: string;
  header?: string;
  title?: string;
  caption?: string;
  textarea?: string;
  chipList?: string;
  chip?: string;
  muted?: string;
  error?: string;
  savedHint?: string;
  primaryButton?: string;
  dangerButton?: string;
  secondaryButton?: string;
  loadingHint?: string;
};

const DEFAULT_THEME: Required<WindChimeBlockedTermsPanelTheme> = {
  root: 'w-full text-slate-800 dark:text-slate-100',
  panel:
    'rounded-2xl border border-violet-200/50 bg-white/40 p-5 shadow-[0_4px_20px_rgba(139,92,246,0.08)] backdrop-blur-xl sm:p-6 dark:border-violet-400/30 dark:bg-slate-900/40',
  header: 'mb-4 flex items-baseline justify-between gap-3',
  title: 'text-sm font-bold tracking-wider text-violet-700 dark:text-violet-200',
  caption: 'mt-1 text-xs text-slate-500 dark:text-slate-400',
  textarea:
    'w-full resize-y rounded-lg border border-violet-300/60 bg-white/70 px-3 py-2 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-300/40 dark:border-violet-400/30 dark:bg-slate-900/60 dark:text-slate-100',
  chipList: 'mt-4 flex flex-wrap gap-1.5',
  chip:
    'rounded-md border border-violet-300/60 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200',
  muted: 'mt-2 text-[11px] text-slate-500 dark:text-slate-400',
  error:
    'mt-3 rounded-lg border border-rose-400 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300',
  savedHint: 'text-[11px] text-emerald-600 dark:text-emerald-300',
  primaryButton:
    'rounded-lg border border-violet-500 bg-violet-500 px-4 py-1.5 text-xs font-bold tracking-wider text-white shadow-sm transition hover:bg-violet-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40',
  dangerButton:
    'rounded-lg border border-rose-400 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-400/60 dark:bg-rose-500/10 dark:text-rose-300',
  secondaryButton:
    'rounded-lg border border-slate-300 bg-white/70 px-3 py-1.5 text-xs text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-slate-800/60 dark:text-slate-200',
  loadingHint: 'text-[10px] text-violet-400/80',
};

function mergeTheme(
  t?: WindChimeBlockedTermsPanelTheme,
): Required<WindChimeBlockedTermsPanelTheme> {
  return { ...DEFAULT_THEME, ...(t ?? {}) };
}

function parseTermsInput(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,，\n]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function readError(res: Response): Promise<string> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    return j?.error ?? res.statusText;
  }
  return (await res.text().catch(() => '')) || res.statusText;
}

export type WindChimeBlockedTermsPanelProps = {
  /** 受控模式：初始词库（宿主从自己的 state 注入） */
  terms?: string[];
  /** 受控模式：保存回调；参数是去重后的词库。抛出 `Error` 会展示在面板内 */
  onSave?: (next: string[]) => Promise<void>;

  /** 拉取模式：GET/PUT 词库的端点；与 `terms/onSave` 二选一 */
  endpoint?: string;
  /** 拉取模式下附加请求头（鉴权用） */
  requestHeaders?: Record<string, string>;
  /** 401 响应回调（宿主通常用来清登录态） */
  onUnauthorized?: () => void;

  /** 面板标题 */
  title?: ReactNode;
  /** 说明文字 */
  caption?: ReactNode;
  /** 输入框 placeholder */
  placeholder?: string;
  /** 预览 chip 上限（多出来显示 `+ N` 折叠） */
  chipPreviewLimit?: number;

  /** 文案覆盖 */
  labels?: {
    save?: string;
    saving?: string;
    loading?: string;
    saved?: string;
    summaryPrefix?: string;
  };

  theme?: WindChimeBlockedTermsPanelTheme;
  className?: string;
};

const DEFAULT_LABELS = {
  save: 'SAVE',
  saving: 'SAVING…',
  loading: 'LOADING…',
  saved: '已保存 ✓',
  summaryPrefix: '用逗号或换行分隔，大小写不敏感。当前共',
};

export function WindChimeBlockedTermsPanel({
  terms: termsProp,
  onSave,
  endpoint,
  requestHeaders,
  onUnauthorized,
  title = 'BLOCKED_TERMS · 敏感词',
  caption = '命中任一词的留言会被折叠在「待审核」tab 里，主播点击才能看到原文。不拦截发送。',
  placeholder = '例如：色情, 赌博, 微信, 加我',
  chipPreviewLimit = 20,
  labels,
  theme,
  className,
}: WindChimeBlockedTermsPanelProps) {
  const th = useMemo(() => mergeTheme(theme), [theme]);
  const L = { ...DEFAULT_LABELS, ...(labels ?? {}) };

  const isControlled = termsProp !== undefined;

  const [internalTerms, setInternalTerms] = useState<string[]>([]);
  const effectiveTerms = isControlled ? termsProp! : internalTerms;

  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // 同步 effectiveTerms → draft（受控模式下 terms 外部变化时也要跟上）
  useEffect(() => {
    setDraft(effectiveTerms.join(', '));
  }, [effectiveTerms]);

  // 拉取模式：挂载时 GET
  const reload = useCallback(async () => {
    if (!endpoint) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(endpoint, {
        headers: requestHeaders,
        cache: 'no-store',
      });
      if (r.status === 401) {
        onUnauthorized?.();
        return;
      }
      if (!r.ok) throw new Error(await readError(r));
      const j = (await r.json()) as { terms?: string[] };
      const list = Array.isArray(j.terms) ? j.terms : [];
      setInternalTerms(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [endpoint, requestHeaders, onUnauthorized]);

  useEffect(() => {
    if (!isControlled && endpoint) void reload();
  }, [isControlled, endpoint, reload]);

  const parsed = useMemo(() => parseTermsInput(draft), [draft]);
  const dirty = useMemo(
    () => !arraysEqual(parsed, effectiveTerms),
    [parsed, effectiveTerms],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      if (onSave) {
        await onSave(parsed);
        setSavedAt(Date.now());
        return;
      }
      if (endpoint) {
        const r = await fetch(endpoint, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(requestHeaders ?? {}),
          },
          body: JSON.stringify({ terms: parsed }),
        });
        if (r.status === 401) {
          onUnauthorized?.();
          return;
        }
        if (!r.ok) throw new Error(await readError(r));
        const j = (await r.json().catch(() => ({ terms: parsed }))) as {
          terms?: string[];
        };
        const list = Array.isArray(j.terms) ? j.terms : parsed;
        setInternalTerms(list);
        setSavedAt(Date.now());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [endpoint, requestHeaders, onSave, onUnauthorized, parsed]);

  return (
    <div className={cn(th.root, className)} data-widget="windchime-blocked-terms">
      <div className={th.panel}>
        <div className={th.header}>
          <div>
            <div className={th.title}>{title}</div>
            <div className={th.caption}>{caption}</div>
          </div>
          {loading && <span className={th.loadingHint}>{L.loading}</span>}
        </div>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={th.textarea}
        />
        <div className={th.muted}>
          {L.summaryPrefix} {parsed.length} 个词。
        </div>

        {error && <div className={th.error}>{error}</div>}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className={th.chipList}>
            {parsed.slice(0, chipPreviewLimit).map((t) => (
              <span key={t} className={th.chip}>
                {t}
              </span>
            ))}
            {parsed.length > chipPreviewLimit && (
              <span className={th.muted}>
                … 还有 {parsed.length - chipPreviewLimit} 个
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {savedAt && !dirty && (
              <span className={th.savedHint}>{L.saved}</span>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading || !dirty}
              className={th.primaryButton}
            >
              {saving ? L.saving : L.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

WindChimeBlockedTermsPanel.displayName = 'WindChimeBlockedTermsPanel';
