"use client";

import React, { useCallback, useEffect, useMemo } from "react";

/**
 * 二维码海报编辑器：给主播调 heading/body/footer/avatar 的小表单。
 * 输出的 `value` 可以直接喂给 `<WindChimeQrCard poster={value} />`。
 *
 * 可选：若传 `storageKey`，组件会自动把 `value` 同步到 `localStorage`，刷新保留。
 */
export type WindChimeQrPosterConfig = {
  heading: string;
  body: string;
  footer: string;
  avatarSrc: string;
};

export const DEFAULT_POSTER_CONFIG: WindChimeQrPosterConfig = {
  heading: "",
  body: "",
  footer: "",
  avatarSrc: "",
};

export type WindChimeQrPosterEditorTheme = {
  panel?: string;
  title?: string;
  fieldList?: string;
  label?: string;
  input?: string;
  textarea?: string;
  avatarPreview?: string;
  avatarImg?: string;
  avatarCaption?: string;
};

export type WindChimeQrPosterEditorProps = {
  value: WindChimeQrPosterConfig;
  onChange: (next: WindChimeQrPosterConfig) => void;

  /** 若设置，组件会把 value 同步到 localStorage，并在首次挂载时回读。 */
  storageKey?: string;

  title?: React.ReactNode;
  labels?: {
    heading?: string;
    body?: string;
    footer?: string;
    avatar?: string;
  };
  placeholders?: {
    heading?: string;
    body?: string;
    footer?: string;
    avatar?: string;
  };
  maxLengths?: {
    heading?: number;
    body?: number;
    footer?: number;
  };

  /** 是否显示头像字段；默认 true。 */
  showAvatarField?: boolean;

  theme?: WindChimeQrPosterEditorTheme;
  className?: string;
};

const DEFAULT_THEME: Required<WindChimeQrPosterEditorTheme> = {
  panel:
    "rounded-[2rem] border border-pink-200/60 bg-white/60 p-5 shadow-[0_8px_30px_rgba(249,78,159,0.08)] backdrop-blur-xl sm:p-6",
  title: "mb-3 text-sm font-bold tracking-wide text-pink-600",
  fieldList: "grid grid-cols-1 gap-3",
  label: "flex flex-col gap-1 text-xs font-medium text-slate-600",
  input:
    "rounded-xl border border-pink-200 bg-white/80 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-pink-400 focus:ring-2 focus:ring-pink-300/30",
  textarea:
    "min-h-[60px] resize-y rounded-xl border border-pink-200 bg-white/80 px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none transition focus:border-pink-400 focus:ring-2 focus:ring-pink-300/30",
  avatarPreview:
    "flex items-center gap-3 rounded-xl border border-pink-100 bg-pink-50/40 p-2",
  avatarImg:
    "h-12 w-12 rounded-full border-2 border-white object-cover shadow",
  avatarCaption: "truncate text-xs text-slate-500",
};

export function WindChimeQrPosterEditor(props: WindChimeQrPosterEditorProps) {
  const {
    value,
    onChange,
    storageKey,
    title = "海报自定义",
    labels,
    placeholders,
    maxLengths,
    showAvatarField = true,
    theme,
    className,
  } = props;

  const th = useMemo<Required<WindChimeQrPosterEditorTheme>>(
    () => ({ ...DEFAULT_THEME, ...(theme ?? {}) }),
    [theme],
  );

  // 首次挂载时从 localStorage 回读
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<WindChimeQrPosterConfig>;
        onChange({ ...value, ...parsed });
      }
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const update = useCallback(
    (patch: Partial<WindChimeQrPosterConfig>) => {
      const next = { ...value, ...patch };
      onChange(next);
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* noop */
        }
      }
    },
    [value, onChange, storageKey],
  );

  const headingLabel = labels?.heading ?? "主标题";
  const bodyLabel = labels?.body ?? "副标题（说明文字）";
  const footerLabel = labels?.footer ?? "落款（留空则显示网址）";
  const avatarLabel = labels?.avatar ?? "头像 URL";

  const headingPh = placeholders?.heading ?? "给主播挂一封风铃";
  const bodyPh = placeholders?.body ?? "扫码后匿名留言，直播时主播会念出来哦 ~";
  const footerPh = placeholders?.footer ?? "";
  const avatarPh = placeholders?.avatar ?? "https://...";

  const headingMax = maxLengths?.heading ?? 24;
  const bodyMax = maxLengths?.body ?? 80;
  const footerMax = maxLengths?.footer ?? 40;

  return (
    <div className={joinClass(th.panel, className)}>
      {title != null && <h3 className={th.title}>{title}</h3>}
      <div className={th.fieldList}>
        <label className={th.label}>
          <span>{headingLabel}</span>
          <input
            className={th.input}
            value={value.heading}
            onChange={(e) => update({ heading: e.target.value })}
            maxLength={headingMax}
            placeholder={headingPh}
          />
        </label>
        <label className={th.label}>
          <span>{bodyLabel}</span>
          <textarea
            className={th.textarea}
            value={value.body}
            onChange={(e) => update({ body: e.target.value })}
            maxLength={bodyMax}
            placeholder={bodyPh}
          />
        </label>
        <label className={th.label}>
          <span>{footerLabel}</span>
          <input
            className={th.input}
            value={value.footer}
            onChange={(e) => update({ footer: e.target.value })}
            maxLength={footerMax}
            placeholder={footerPh}
          />
        </label>
        {showAvatarField && (
          <>
            <label className={th.label}>
              <span>{avatarLabel}</span>
              <input
                className={th.input}
                value={value.avatarSrc}
                onChange={(e) => update({ avatarSrc: e.target.value.trim() })}
                placeholder={avatarPh}
              />
            </label>
            {value.avatarSrc && (
              <div className={th.avatarPreview}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={value.avatarSrc}
                  alt="头像预览"
                  referrerPolicy="no-referrer"
                  className={th.avatarImg}
                />
                <span className={th.avatarCaption}>{value.avatarSrc}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function joinClass(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}
