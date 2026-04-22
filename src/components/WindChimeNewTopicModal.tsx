'use client';

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  WIND_CHIME_DEFAULT_TIME_ZONE,
  windChimeLocalToUtcIso,
  windChimeNowAsLocal,
  windChimePlusDaysAsLocal,
} from '../time';
import {
  WIND_CHIME_TOPIC_RESERVED_SLUGS,
  WIND_CHIME_TOPIC_SLUG_REGEX,
  type WindChimeTopic,
  type WindChimeTopicCreateInput,
} from '../types-topics';
import '../styles/windchime.css';

/**
 * 新建主题模态。
 *
 * 表单行为：
 * - `title` 必填、1~64 字符
 * - `slug` 必填、符合 `[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?` 且不命中保留字
 * - `description` / `note` 可选
 * - 默认勾选时间窗（开始=当前时区现在，结束=+7 天）；取消勾选 → 弹气泡
 *   警告"无时间窗 ≈ 常规信箱平行版"，确认后才写 `startsAt=null, endsAt=null`
 *
 * 提交逻辑两种：
 * 1. **受控**：传 `onSubmit(input) => Promise<WindChimeTopic>`，宿主自行 POST。
 *    失败抛 `Error` 即在面板里显示文案
 * 2. **拉取**：传 `endpoint`，组件内部 POST JSON。成功后会把服务器响应
 *    还原为 `WindChimeTopic` 传给 `onCreated`
 *
 * 时间输入一律按 `timeZone`（默认 `Asia/Shanghai`）理解，入库前会转为
 * UTC ISO Z 串。
 */

function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

function validateSlugClient(
  slug: string,
  reservedSlugs: readonly string[],
): string | null {
  if (!slug) return 'slug 不能为空';
  if (!WIND_CHIME_TOPIC_SLUG_REGEX.test(slug)) {
    return '只能包含 a-z、0-9、短横；1~64 字符；首尾必须是字母/数字';
  }
  if (reservedSlugs.includes(slug)) return `"${slug}" 是系统保留字`;
  return null;
}

async function readError(res: Response): Promise<string> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    return j?.error ?? res.statusText;
  }
  return (await res.text().catch(() => '')) || res.statusText;
}

export type WindChimeNewTopicModalTheme = {
  overlay?: string;
  form?: string;
  closeButton?: string;
  badge?: string;
  title?: string;
  fieldList?: string;
  fieldLabel?: string;
  fieldHint?: string;
  input?: string;
  inputError?: string;
  errLine?: string;
  timeWindowWrap?: string;
  timeWindowLabel?: string;
  timeWindowHint?: string;
  timeRow?: string;
  timeLabel?: string;
  timeInput?: string;
  permanentWarn?: string;
  serverError?: string;
  footer?: string;
  cancelButton?: string;
  submitButton?: string;
  permanentOverlay?: string;
  permanentModal?: string;
  permanentTitle?: string;
  permanentBody?: string;
  permanentActions?: string;
  permanentKeep?: string;
  permanentConfirm?: string;
};

const DEFAULT_THEME: Required<WindChimeNewTopicModalTheme> = {
  overlay:
    'fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md',
  form:
    'relative w-full max-w-xl rounded-2xl border border-violet-300/60 bg-white p-6 shadow-[0_10px_40px_rgba(139,92,246,0.2)] dark:border-violet-400/60 dark:bg-slate-900',
  closeButton:
    'absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-violet-300 bg-white/80 text-violet-600 transition hover:bg-violet-500 hover:text-white dark:border-violet-400/60 dark:bg-slate-900/80 dark:text-violet-200',
  badge:
    'mb-1 font-mono text-[11px] tracking-[0.25em] text-violet-600/80 dark:text-violet-300/80',
  title: 'text-lg font-bold tracking-wide text-violet-800 dark:text-violet-100',
  fieldList: 'mt-5 space-y-4',
  fieldLabel:
    'mb-1 font-mono text-[11px] uppercase tracking-widest text-violet-600/80 dark:text-violet-300/80',
  fieldHint: 'mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400',
  input:
    'w-full rounded-lg border border-violet-300/60 bg-white/80 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-400/20 dark:border-violet-400/30 dark:bg-slate-900/60 dark:text-slate-100',
  inputError:
    'w-full rounded-lg border border-rose-400 bg-white/80 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-400/20 dark:border-rose-400/60 dark:bg-slate-900/60 dark:text-slate-100',
  errLine: 'mt-1 font-mono text-[11px] text-rose-600 dark:text-rose-300',
  timeWindowWrap:
    'rounded-lg border border-violet-300/50 bg-violet-50/60 p-3 dark:border-violet-400/30 dark:bg-violet-500/[0.03]',
  timeWindowLabel:
    'flex items-center gap-2 font-mono text-xs text-violet-800 dark:text-violet-200',
  timeWindowHint: 'mt-2 font-mono text-[11px] text-amber-700 dark:text-amber-300/80',
  timeRow: 'mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2',
  timeLabel: 'mb-1 font-mono text-[11px] text-violet-700/80 dark:text-violet-300/80',
  timeInput:
    'w-full rounded-lg border border-violet-300/60 bg-white/80 px-3 py-2 font-mono text-xs text-slate-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-400/20 dark:border-violet-400/30 dark:bg-slate-900/60 dark:text-slate-100',
  permanentWarn: '',
  serverError:
    'mt-4 rounded-lg border border-rose-400 bg-rose-50 px-3 py-2 font-mono text-xs text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300',
  footer: 'mt-5 flex items-center justify-end gap-2',
  cancelButton:
    'rounded-lg border border-slate-300 bg-white/80 px-4 py-2 font-mono text-xs text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/60',
  submitButton:
    'rounded-lg border border-violet-500 bg-violet-500 px-4 py-2 font-mono text-xs font-bold tracking-widest text-white shadow-sm transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40',
  permanentOverlay:
    'absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/80 p-6',
  permanentModal:
    'max-w-sm rounded-xl border border-amber-400 bg-white p-5 text-center shadow-[0_10px_32px_rgba(251,191,36,0.35)] dark:border-amber-400/60 dark:bg-slate-900',
  permanentTitle:
    'mb-2 text-sm font-bold tracking-wide text-amber-700 dark:text-amber-200',
  permanentBody:
    'mb-4 font-mono text-xs leading-relaxed text-amber-800 dark:text-amber-100/80',
  permanentActions: 'flex items-center justify-center gap-2',
  permanentKeep:
    'rounded-lg border border-violet-400 bg-white px-3 py-1.5 font-mono text-xs text-violet-700 transition hover:bg-violet-50 dark:border-violet-400/60 dark:bg-slate-900/60 dark:text-violet-200 dark:hover:bg-violet-400/10',
  permanentConfirm:
    'rounded-lg border border-amber-500 bg-amber-400 px-3 py-1.5 font-mono text-xs font-bold text-amber-900 transition hover:bg-amber-300',
};

function mergeTheme(
  t?: WindChimeNewTopicModalTheme,
): Required<WindChimeNewTopicModalTheme> {
  return { ...DEFAULT_THEME, ...(t ?? {}) };
}

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

export type WindChimeNewTopicModalLabels = {
  badge?: string;
  heading?: string;
  titleField?: string;
  titleHint?: string;
  slugField?: string;
  slugHintTemplate?: string; // `{slug}` 占位符
  descriptionField?: string;
  descriptionHint?: string;
  noteField?: string;
  noteHint?: string;
  timeWindowLabel?: string;
  timeWindowKeyword?: string;
  startsLabel?: string;
  endsLabel?: string;
  noTimeWindowHint?: string;
  permanentWarnTitle?: string;
  permanentWarnBody?: string;
  permanentKeep?: string;
  permanentConfirm?: string;
  cancel?: string;
  submit?: string;
  submitting?: string;
  titleTooLong?: string;
  timeRangeError?: string;
};

const DEFAULT_LABELS: Required<WindChimeNewTopicModalLabels> = {
  badge: 'NEW TOPIC · 新建主题',
  heading: '创建一个活动收件箱',
  titleField: '主题标题 *',
  titleHint: '活动期间顶部横幅会显示；可以带 emoji',
  slugField: 'URL slug *',
  slugHintTemplate: '访客链接为 /m/{slug}；创建后不可修改',
  descriptionField: '说明（访客可见）',
  descriptionHint: '出现在投信页的副标题，简短提示',
  noteField: '备注（仅主播可见）',
  noteHint: '给自己记笔记，访客看不到',
  timeWindowLabel: '启用时间窗（按{zone}理解）',
  timeWindowKeyword: '北京时间',
  startsLabel: '开始时间',
  endsLabel: '结束时间',
  noTimeWindowHint:
    '⚠ 无时间窗 = 只要开关开着就一直可投信（≈ 常规信箱）',
  permanentWarnTitle: '⚠ 永久活动',
  permanentWarnBody:
    '不设时间窗 ≈ 常规信箱的平行版，除非你清楚想要这样，否则建议保留时间窗。',
  permanentKeep: '保留时间窗',
  permanentConfirm: '我确定要永久活动',
  cancel: '取消',
  submit: 'CREATE',
  submitting: 'CREATING…',
  titleTooLong: '标题超过 64 字符',
  timeRangeError: '开始时间不能晚于或等于结束时间',
};

export type WindChimeNewTopicModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (topic: WindChimeTopic) => void;

  /** 受控：直接把 input 交给宿主，宿主自行 POST 并返回 Topic */
  onSubmit?: (input: WindChimeTopicCreateInput) => Promise<WindChimeTopic>;

  /** 拉取模式：POST `{ ... }` → 返回 `WindChimeTopic` */
  endpoint?: string;
  /** 拉取模式下附加请求头（管理端鉴权） */
  requestHeaders?: Record<string, string>;

  /** 时区（默认 Asia/Shanghai） */
  timeZone?: string;

  /** 保留字黑名单（默认包含 default/new/admin/api/m） */
  reservedSlugs?: readonly string[];

  closeIcon?: ReactNode;
  labels?: WindChimeNewTopicModalLabels;
  theme?: WindChimeNewTopicModalTheme;
};

export function WindChimeNewTopicModal({
  open,
  onClose,
  onCreated,
  onSubmit,
  endpoint,
  requestHeaders,
  timeZone = WIND_CHIME_DEFAULT_TIME_ZONE,
  reservedSlugs = WIND_CHIME_TOPIC_RESERVED_SLUGS,
  closeIcon = DEFAULT_CLOSE_ICON,
  labels,
  theme,
}: WindChimeNewTopicModalProps) {
  const th = useMemo(() => mergeTheme(theme), [theme]);
  const L = { ...DEFAULT_LABELS, ...(labels ?? {}) };

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [useTimeWindow, setUseTimeWindow] = useState(true);
  const [startsLocal, setStartsLocal] = useState('');
  const [endsLocal, setEndsLocal] = useState('');
  const [showPermanentWarn, setShowPermanentWarn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // 打开时重置表单 + 重置到默认时间窗
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setSlug('');
    setDescription('');
    setNote('');
    setUseTimeWindow(true);
    setStartsLocal(windChimeNowAsLocal(timeZone));
    setEndsLocal(windChimePlusDaysAsLocal(7, timeZone));
    setShowPermanentWarn(false);
    setServerError(null);
  }, [open, timeZone]);

  // ESC 关闭 + 锁滚动
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const slugError = useMemo(
    () => (slug ? validateSlugClient(slug, reservedSlugs) : null),
    [slug, reservedSlugs],
  );
  const titleError = useMemo(() => {
    const t = title.trim();
    if (!t) return null;
    if (t.length > 64) return L.titleTooLong;
    return null;
  }, [title, L.titleTooLong]);

  const timeRangeError = useMemo(() => {
    if (!useTimeWindow) return null;
    if (!startsLocal || !endsLocal) return null;
    if (startsLocal >= endsLocal) return L.timeRangeError;
    return null;
  }, [useTimeWindow, startsLocal, endsLocal, L.timeRangeError]);

  const canSubmit =
    !!title.trim() &&
    !!slug &&
    !slugError &&
    !titleError &&
    !timeRangeError &&
    !submitting;

  const onToggleTimeWindow = (next: boolean) => {
    if (!next && useTimeWindow) {
      setShowPermanentWarn(true);
      return;
    }
    setUseTimeWindow(next);
  };

  const confirmPermanent = () => {
    setUseTimeWindow(false);
    setShowPermanentWarn(false);
  };
  const cancelPermanent = () => {
    setShowPermanentWarn(false);
  };

  const doSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const input: WindChimeTopicCreateInput = {
        title: title.trim(),
        slug,
        description: description.trim() || null,
        note: note.trim() || null,
        startsAt: useTimeWindow ? windChimeLocalToUtcIso(startsLocal, timeZone) : null,
        endsAt: useTimeWindow ? windChimeLocalToUtcIso(endsLocal, timeZone) : null,
      };

      if (onSubmit) {
        const topic = await onSubmit(input);
        onCreated(topic);
        onClose();
        return;
      }
      if (endpoint) {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(requestHeaders ?? {}) },
          body: JSON.stringify(input),
        });
        if (!r.ok) throw new Error(await readError(r));
        const topic = (await r.json()) as WindChimeTopic;
        onCreated(topic);
        onClose();
        return;
      }
      throw new Error('未提供 onSubmit / endpoint');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (typeof document === 'undefined') return null;
  if (!open) return null;

  const slugHint = L.slugHintTemplate.replace('{slug}', slug || 'your-slug');
  const timeWindowLabel = L.timeWindowLabel.replace(
    '{zone}',
    `「${L.timeWindowKeyword}」`,
  );

  return createPortal(
    <div
      className={cn(th.overlay, 'windchime-overlay-enter')}
      onClick={onClose}
    >
      <form
        onSubmit={doSubmit}
        className={cn(th.form, 'windchime-modal-enter')}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className={th.closeButton}
        >
          {closeIcon}
        </button>

        <div className={th.badge}>{L.badge}</div>
        <h2 className={th.title}>{L.heading}</h2>

        <div className={th.fieldList}>
          <Field label={L.titleField} hint={L.titleHint} th={th}>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={64}
              placeholder="🎂 生日快乐来信 2026"
              className={titleError ? th.inputError : th.input}
            />
            {titleError && <div className={th.errLine}>✕ {titleError}</div>}
          </Field>

          <Field label={L.slugField} hint={slugHint} th={th}>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              maxLength={64}
              placeholder="birthday-2026"
              className={slugError ? th.inputError : th.input}
            />
            {slugError && <div className={th.errLine}>✕ {slugError}</div>}
          </Field>

          <Field label={L.descriptionField} hint={L.descriptionHint} th={th}>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="活动期间写下你的祝福"
              className={th.input}
            />
          </Field>

          <Field label={L.noteField} hint={L.noteHint} th={th}>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className={th.input}
            />
          </Field>

          <div className={th.timeWindowWrap}>
            <label className={th.timeWindowLabel}>
              <input
                type="checkbox"
                checked={useTimeWindow}
                onChange={(e) => onToggleTimeWindow(e.target.checked)}
                style={{ accentColor: '#8b5cf6' }}
              />
              {timeWindowLabel}
            </label>
            {useTimeWindow && (
              <div className={th.timeRow}>
                <label>
                  <div className={th.timeLabel}>{L.startsLabel}</div>
                  <input
                    type="datetime-local"
                    value={startsLocal}
                    onChange={(e) => setStartsLocal(e.target.value)}
                    className={th.timeInput}
                  />
                </label>
                <label>
                  <div className={th.timeLabel}>{L.endsLabel}</div>
                  <input
                    type="datetime-local"
                    value={endsLocal}
                    onChange={(e) => setEndsLocal(e.target.value)}
                    className={th.timeInput}
                  />
                </label>
              </div>
            )}
            {timeRangeError && (
              <div className="mt-2">
                <div className={th.errLine}>✕ {timeRangeError}</div>
              </div>
            )}
            {!useTimeWindow && (
              <div className={th.timeWindowHint}>{L.noTimeWindowHint}</div>
            )}
          </div>
        </div>

        {serverError && <div className={th.serverError}>{serverError}</div>}

        <div className={th.footer}>
          <button type="button" onClick={onClose} className={th.cancelButton}>
            {L.cancel}
          </button>
          <button type="submit" disabled={!canSubmit} className={th.submitButton}>
            {submitting ? L.submitting : L.submit}
          </button>
        </div>

        {showPermanentWarn && (
          <div className={th.permanentOverlay}>
            <div className={th.permanentModal}>
              <div className={th.permanentTitle}>{L.permanentWarnTitle}</div>
              <p className={th.permanentBody}>{L.permanentWarnBody}</p>
              <div className={th.permanentActions}>
                <button
                  type="button"
                  onClick={cancelPermanent}
                  className={th.permanentKeep}
                >
                  {L.permanentKeep}
                </button>
                <button
                  type="button"
                  onClick={confirmPermanent}
                  className={th.permanentConfirm}
                >
                  {L.permanentConfirm}
                </button>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>,
    document.body,
  );
}

WindChimeNewTopicModal.displayName = 'WindChimeNewTopicModal';

function Field({
  label,
  hint,
  th,
  children,
}: {
  label: string;
  hint?: string;
  th: Required<WindChimeNewTopicModalTheme>;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className={th.fieldLabel}>{label}</div>
      {children}
      {hint && <div className={th.fieldHint}>{hint}</div>}
    </label>
  );
}
