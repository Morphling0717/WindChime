"use client";

import {
  useId,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { WindChimeSenderProps, WindChimeTheme } from "../types.js";
import "../styles/windchime.css";
import { useWindChimeSubmission } from "../react/submission.js";
import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from "./TurnstileWidget.js";

function cn(...parts: (string | undefined | false)[]) {
  return parts.filter(Boolean).join(" ");
}

const defaultTheme: Required<
  Pick<
    WindChimeTheme,
    | "root"
    | "panel"
    | "header"
    | "title"
    | "statusOpen"
    | "statusPaused"
    | "tagline"
    | "textarea"
    | "secondaryInput"
    | "counter"
    | "primaryButton"
    | "primaryButtonDisabled"
    | "secondaryButton"
    | "successBanner"
    | "errorBanner"
    | "turnstileWrap"
  >
> = {
  root: "w-full max-w-lg text-slate-800",
  panel:
    "relative overflow-hidden rounded-[2.5rem] border border-white/40 bg-white/20 p-6 sm:p-10 shadow-[0_8px_40px_rgba(120,110,150,0.12)] backdrop-blur-2xl before:absolute before:inset-0 before:-z-10 before:bg-gradient-to-br before:from-white/60 before:via-white/10 before:to-transparent dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-100 dark:before:from-white/5 dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)]",
  header: "mb-5 flex items-start justify-between gap-3",
  title:
    "text-2xl font-bold tracking-tight bg-gradient-to-br from-violet-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-violet-300 dark:to-fuchsia-300",
  statusOpen:
    "rounded-full bg-gradient-to-r from-emerald-400/20 to-teal-400/20 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300",
  statusPaused:
    "rounded-full bg-gradient-to-r from-amber-400/20 to-orange-400/20 px-3 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300",
  tagline:
    "mb-6 text-[15px] font-medium leading-relaxed text-slate-600 dark:text-slate-300",
  textarea:
    "min-h-[160px] w-full resize-y rounded-2xl border border-white/40 bg-white/60 px-5 py-4 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 outline-none shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)] transition hover:bg-white/80 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-400/20 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:bg-slate-900/50 dark:focus:bg-slate-900",
  secondaryInput:
    "mt-3 w-full rounded-2xl border border-white/40 bg-white/60 px-5 py-3.5 text-[15px] text-slate-900 placeholder:text-slate-400 outline-none shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)] transition hover:bg-white/80 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-400/20 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:bg-slate-900/50 dark:focus:bg-slate-900",
  counter:
    "mt-2 text-right text-[11px] font-medium tracking-wide text-slate-400",
  primaryButton:
    "mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 bg-[length:200%_auto] px-5 py-4 text-base font-bold tracking-wide text-white shadow-[0_8px_20px_rgba(167,139,250,0.35)] transition-all hover:bg-[position:right_center] hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(167,139,250,0.45)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0",
  primaryButtonDisabled: "saturate-50",
  secondaryButton:
    "mt-3 inline-flex w-full items-center justify-center rounded-2xl border border-violet-200 bg-violet-50/60 px-5 py-3.5 text-sm font-bold tracking-wide text-violet-700 transition hover:bg-violet-100/60 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20",
  successBanner:
    "mt-5 rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-emerald-100/50 px-6 py-5 text-[15px] font-medium leading-relaxed text-emerald-900 shadow-sm dark:border-emerald-500/20 dark:from-emerald-500/10 dark:to-emerald-500/5 dark:text-emerald-100",
  errorBanner:
    "mt-5 rounded-2xl border border-red-200 bg-gradient-to-b from-red-50 to-red-100/50 px-6 py-4 text-[14px] font-medium leading-relaxed text-red-900 shadow-sm dark:border-red-500/20 dark:from-red-500/10 dark:to-red-500/5 dark:text-red-100",
  turnstileWrap: "mt-4 flex min-h-[68px] justify-center",
};

function mergeTheme(t?: WindChimeTheme) {
  return {
    root: t?.root ?? defaultTheme.root,
    panel: t?.panel ?? defaultTheme.panel,
    header: t?.header ?? defaultTheme.header,
    title: t?.title ?? defaultTheme.title,
    statusOpen: t?.statusOpen ?? defaultTheme.statusOpen,
    statusPaused: t?.statusPaused ?? defaultTheme.statusPaused,
    tagline: t?.tagline ?? defaultTheme.tagline,
    textarea: t?.textarea ?? defaultTheme.textarea,
    secondaryInput: t?.secondaryInput ?? defaultTheme.secondaryInput,
    counter: t?.counter ?? defaultTheme.counter,
    primaryButton: t?.primaryButton ?? defaultTheme.primaryButton,
    primaryButtonDisabled:
      t?.primaryButtonDisabled ?? defaultTheme.primaryButtonDisabled,
    secondaryButton: t?.secondaryButton ?? defaultTheme.secondaryButton,
    successBanner: t?.successBanner ?? defaultTheme.successBanner,
    errorBanner: t?.errorBanner ?? defaultTheme.errorBanner,
    turnstileWrap: t?.turnstileWrap ?? defaultTheme.turnstileWrap,
  };
}

export function WindChimeSender({
  title = "风铃",
  statusOpenLabel = "迎风飘摇中",
  statusPausedLabel = "休息避风中",
  status = "open",
  tagline = "把你想说的话，挂在风铃上吧~",
  pausedMessage = "风铃暂时休息，不接新的来信。欢迎稍后再来~",
  placeholder = "在这里写下你想说的话…",
  maxLength = 1000,
  successMessage = "你的心意已随风传达啦！",
  rateLimit = { max: 3, windowMs: 60_000, storageKey: "windchime:rl" },
  onSubmit,
  successAudioSrc,
  enableSwayAnimation = true,
  theme,
  className,
  showWhenPaused = true,
  collectNickname = false,
  nicknamePlaceholder = "称呼（可选，不填则匿名）",
  nicknameMaxLength = 32,
  collectLinkUrl = false,
  linkPlaceholder = "相关链接 https://…（可选）",
  linkMaxLength = 500,
  turnstileSiteKey,
  blockedTerms,
  blockedTermsMessage = "内容包含不允许的词，请修改后再试。",
  disableSenderFingerprint = false,
  senderFingerprintKey = "windchime:fp",
}: WindChimeSenderProps) {
  const th = useMemo(() => mergeTheme(theme), [theme]);
  const baseId = useId();
  const messageId = `${baseId}-message`;
  const nicknameId = `${baseId}-nickname`;
  const linkId = `${baseId}-link`;

  const form = useWindChimeSubmission({
    onSubmit,
    enabled: status !== "paused",
    requireTurnstile: Boolean(turnstileSiteKey),
    rateLimit,
    maxLength,
    nicknameMaxLength,
    linkMaxLength,
    blockedTerms,
    disableSenderFingerprint,
    senderFingerprintKey,
  });
  const {
    text,
    setText,
    nickname,
    setNickname,
    linkRaw,
    setLinkRaw,
    sending,
    success,
    setTurnstileToken,
  } = form;
  useEffect(() => {
    if (!collectNickname) setNickname("");
  }, [collectNickname, setNickname]);
  useEffect(() => {
    if (!collectLinkUrl) setLinkRaw("");
  }, [collectLinkUrl, setLinkRaw]);
  const [sway, setSway] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const paused = status === "paused";
  const len = text.length;
  const canSend = form.canSubmit;
  const messages: Record<string, string> = {
    BLOCKED_TERM: blockedTermsMessage,
    INVALID_LINK: "链接格式不正确，请输入以 http:// 或 https:// 开头的地址。",
    TURNSTILE_REQUIRED: "请先完成人机验证。",
    TEXT_REQUIRED: "请输入留言内容。",
    TEXT_TOO_LONG: "留言内容过长。",
    NICKNAME_TOO_LONG: "称呼过长。",
    LINK_TOO_LONG: "链接过长。",
    SUBMISSIONS_CLOSED: pausedMessage,
  };
  const error = form.error
    ? form.error.code === "RATE_LIMITED"
      ? `发送太频繁啦，请 ${Math.ceil((form.retryAfterMs || form.error.retryAfterMs || 1000) / 1000)} 秒后再试。`
      : (messages[form.error.code] ?? form.error.message)
    : null;
  const dismissSuccess = () => {
    form.clearSuccess();
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const sent = await form.submit();
    turnstileRef.current?.reset();
    if (!sent) return;
    if (enableSwayAnimation) {
      setSway(true);
      window.setTimeout(() => setSway(false), 2000);
    }
    if (successAudioSrc) {
      const audio = new Audio(successAudioSrc);
      audio.volume = 0.35;
      void audio.play().catch(() => {});
    }
    window.setTimeout(form.clearSuccess, 4500);
  };

  if (paused && !showWhenPaused) {
    return (
      <div className={cn(th.root, className)} data-widget="windchime-sender">
        <div className={th.panel}>
          <div className={th.header}>
            <div className="flex items-center gap-2">
              <span className="text-2xl leading-none" aria-hidden>
                🎐
              </span>
              <h2 className={th.title}>{title}</h2>
            </div>
            <span className={th.statusPaused} data-status={status}>
              {statusPausedLabel}
            </span>
          </div>
          <p className={th.tagline}>{pausedMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(th.root, className)} data-widget="windchime-sender">
      <div className={th.panel}>
        <div className={th.header}>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-2xl leading-none",
                sway && "windchime-sway-active",
              )}
              aria-hidden
            >
              🎐
            </span>
            <h2 className={th.title}>{title}</h2>
          </div>
          <span
            className={status === "open" ? th.statusOpen : th.statusPaused}
            data-status={status}
          >
            {status === "open" ? statusOpenLabel : statusPausedLabel}
          </span>
        </div>

        <p className={th.tagline}>{tagline}</p>

        <form onSubmit={handleSubmit} noValidate>
          <label className="sr-only" htmlFor={messageId}>
            留言内容
          </label>
          {collectNickname && (
            <>
              <label className="sr-only" htmlFor={nicknameId}>
                称呼
              </label>
              <input
                id={nicknameId}
                name="nickname"
                type="text"
                className={th.secondaryInput}
                placeholder={nicknamePlaceholder}
                maxLength={nicknameMaxLength}
                value={nickname}
                disabled={paused || sending}
                onChange={(e) => setNickname(e.target.value)}
                autoComplete="nickname"
              />
            </>
          )}
          {collectLinkUrl && (
            <>
              <label className="sr-only" htmlFor={linkId}>
                相关链接
              </label>
              <input
                id={linkId}
                name="link"
                type="url"
                inputMode="url"
                className={th.secondaryInput}
                placeholder={linkPlaceholder}
                maxLength={linkMaxLength}
                value={linkRaw}
                disabled={paused || sending}
                onChange={(e) => setLinkRaw(e.target.value)}
                autoComplete="url"
              />
            </>
          )}
          <textarea
            ref={textareaRef}
            id={messageId}
            name="message"
            className={th.textarea}
            placeholder={placeholder}
            maxLength={maxLength}
            value={text}
            disabled={paused || sending}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
          />
          <div className={th.counter}>
            {len} / {maxLength}
          </div>

          {turnstileSiteKey ? (
            <TurnstileWidget
              ref={turnstileRef}
              className={th.turnstileWrap}
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
            />
          ) : null}

          <button
            type="submit"
            className={cn(
              th.primaryButton,
              (!canSend || paused) && th.primaryButtonDisabled,
            )}
            disabled={!canSend}
          >
            {sending ? (
              <span className="inline-flex items-center gap-2">
                <span
                  className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  aria-hidden
                />
                发送中…
              </span>
            ) : paused ? (
              "暂不接信"
            ) : (
              "挂上风铃"
            )}
          </button>
        </form>

        {success && (
          <div
            className={cn(th.successBanner, "windchime-success-enter")}
            role="status"
          >
            <p className="mb-3">{successMessage}</p>
            <button
              type="button"
              className={th.secondaryButton}
              onClick={dismissSuccess}
            >
              再写一条
            </button>
          </div>
        )}
        {error && (
          <p className={th.errorBanner} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

WindChimeSender.displayName = "WindChimeSender";
