"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { WindChimeSender } from "./WindChimeSender";
import type {
  WindChimeSenderProps,
  WindChimeSubmitPayload,
} from "../types";

/**
 * 浮动风铃按钮：固定在角落，点击弹出留言面板（内嵌 `WindChimeSender`）。
 *
 * 两种开关状态来源（二选一即可）：
 * - 受控：直接传 `enabled` 布尔值。`null` 表示未知/加载中。
 * - 自动轮询：传 `settingsUrl`，组件会 `GET` 该端点并期待返回 `{ enabled: boolean }`。
 *
 * 关闭时：按钮灰化 + 禁用摇曳 + 模态内部顶部横幅提示并阻断提交。
 */
export type WindChimeFloatingButtonTheme = {
  buttonBase?: string;
  buttonEnabled?: string;
  buttonDisabled?: string;
  iconEnabled?: string;
  iconDisabled?: string;
  dot?: string;
  overlay?: string;
  modalWrap?: string;
  closeButton?: string;
  disabledBanner?: string;
  senderWrapDisabled?: string;
};

export type WindChimeFloatingButtonProps = {
  /** 用户提交回调；组件会在关闭时拦截并抛出 `disabledMessage`。 */
  onSubmit: (payload: WindChimeSubmitPayload) => Promise<void>;

  /** 受控的开关状态；`null` 视为加载中。 */
  enabled?: boolean | null;
  /** 自动轮询开关状态的端点（`GET` 返回 `{ enabled: boolean }`）。与 `enabled` 二选一。 */
  settingsUrl?: string;
  /** 轮询间隔；默认 30_000。 */
  pollIntervalMs?: number;
  /** 关闭时提交/悬停提示。 */
  disabledMessage?: string;
  /** 关闭时面板顶部横幅文案。 */
  disabledBannerText?: ReactNode;

  /** 按钮图标；默认 🎐。 */
  icon?: ReactNode;
  /** 固定位置；默认 bottom-left。 */
  position?: "bottom-left" | "bottom-right" | "top-left" | "top-right";
  ariaLabel?: string;
  /** 是否启用 6 秒一次的轻摇曳动画；默认 true。 */
  enableSway?: boolean;
  swayIntervalMs?: number;

  /** 透传给内部 `WindChimeSender` 的 props（`onSubmit` 由组件自身托管）。 */
  senderProps?: Omit<WindChimeSenderProps, "onSubmit">;

  theme?: WindChimeFloatingButtonTheme;
  className?: string;
};

const POSITION_CLASS: Record<NonNullable<WindChimeFloatingButtonProps["position"]>, string> = {
  "bottom-left": "fixed bottom-6 left-6",
  "bottom-right": "fixed bottom-6 right-6",
  "top-left": "fixed top-6 left-6",
  "top-right": "fixed top-6 right-6",
};

const DEFAULT_THEME: Required<WindChimeFloatingButtonTheme> = {
  buttonBase:
    "z-[60] flex h-16 w-16 items-center justify-center rounded-full text-3xl backdrop-blur-md transition",
  buttonEnabled:
    "border border-pink-200/80 bg-gradient-to-br from-white/90 to-pink-50/90 shadow-[0_8px_30px_rgba(249,78,159,0.25)] hover:shadow-[0_12px_36px_rgba(249,78,159,0.4)]",
  buttonDisabled:
    "border border-slate-300/70 bg-slate-200/80 shadow-[0_6px_20px_rgba(100,100,120,0.18)] grayscale cursor-not-allowed",
  iconEnabled: "drop-shadow-[0_2px_6px_rgba(249,78,159,0.45)]",
  iconDisabled: "opacity-60",
  dot:
    "pointer-events-none absolute -top-1 -right-1 inline-flex h-3 w-3 items-center justify-center",
  overlay:
    "fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4",
  modalWrap: "relative w-full max-w-lg",
  closeButton:
    "absolute -top-2 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/60 bg-white/80 text-slate-500 shadow-md transition hover:text-slate-900 sm:-top-3 sm:-right-3",
  disabledBanner:
    "mb-4 rounded-2xl border border-slate-200 bg-slate-50/90 p-4 text-center text-sm text-slate-600 shadow-sm backdrop-blur-md",
  senderWrapDisabled: "pointer-events-none select-none opacity-60 grayscale",
};

export function WindChimeFloatingButton(props: WindChimeFloatingButtonProps) {
  const {
    onSubmit,
    enabled: enabledProp,
    settingsUrl,
    pollIntervalMs = 30_000,
    disabledMessage = "风铃暂时关闭",
    disabledBannerText = "🎐 风铃暂时关闭，稍后再来看看吧 ~",
    icon = "🎐",
    position = "bottom-left",
    ariaLabel = "给主播留言",
    enableSway = true,
    swayIntervalMs = 6000,
    senderProps,
    theme,
    className,
  } = props;

  const th = useMemo<Required<WindChimeFloatingButtonTheme>>(
    () => ({ ...DEFAULT_THEME, ...(theme ?? {}) }),
    [theme],
  );

  const [polledEnabled, setPolledEnabled] = useState<boolean | null>(null);
  const controlled = enabledProp !== undefined;
  const enabled: boolean | null = controlled ? enabledProp ?? null : polledEnabled;

  const [open, setOpen] = useState(false);
  const [sway, setSway] = useState(false);

  // 轮询开关
  useEffect(() => {
    if (controlled || !settingsUrl) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const r = await fetch(settingsUrl, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { enabled?: boolean };
        if (!cancelled && typeof j.enabled === "boolean") setPolledEnabled(j.enabled);
      } catch {
        /* noop */
      }
    };
    void refresh();
    const id = window.setInterval(refresh, pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [controlled, settingsUrl, pollIntervalMs]);

  // 摇曳动画
  useEffect(() => {
    if (!enableSway || enabled === false) return;
    const id = window.setInterval(() => {
      setSway(true);
      window.setTimeout(() => setSway(false), 1200);
    }, swayIntervalMs);
    return () => window.clearInterval(id);
  }, [enableSway, enabled, swayIntervalMs]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const handleSubmit = useCallback(
    async (payload: WindChimeSubmitPayload) => {
      if (enabled === false) throw new Error(disabledMessage);
      await onSubmit(payload);
    },
    [enabled, onSubmit, disabledMessage],
  );

  const isDisabled = enabled === false;

  return (
    <>
      <button
        type="button"
        aria-label={isDisabled ? disabledMessage : ariaLabel}
        title={isDisabled ? disabledMessage : undefined}
        onClick={() => setOpen(true)}
        className={joinClass(
          POSITION_CLASS[position],
          th.buttonBase,
          isDisabled ? th.buttonDisabled : th.buttonEnabled,
          className,
        )}
        style={
          sway
            ? { animation: "windchime-sway 1.2s ease-in-out" }
            : undefined
        }
      >
        <span aria-hidden className={isDisabled ? th.iconDisabled : th.iconEnabled}>
          {icon}
        </span>
        {!isDisabled && (
          <span className={th.dot}>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pink-300/70" />
            <span className="relative inline-block h-2 w-2 rounded-full bg-pink-500" />
          </span>
        )}
      </button>

      {open && (
        <div className={th.overlay} onClick={() => setOpen(false)}>
          <div className={th.modalWrap} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭"
              className={th.closeButton}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            {isDisabled && <div className={th.disabledBanner}>{disabledBannerText}</div>}

            <div
              className={isDisabled ? th.senderWrapDisabled : undefined}
              aria-disabled={isDisabled}
            >
              <WindChimeSender {...(senderProps ?? {})} onSubmit={handleSubmit} />
            </div>
          </div>
        </div>
      )}
      {/* 无 framer-motion 依赖；内联 keyframes 供 button 的 animation 引用 */}
      <style>{`@keyframes windchime-sway { 0% { transform: rotate(0deg); } 20% { transform: rotate(-14deg); } 40% { transform: rotate(10deg); } 60% { transform: rotate(-6deg); } 80% { transform: rotate(4deg); } 100% { transform: rotate(0deg); } }`}</style>
    </>
  );
}

function joinClass(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}
