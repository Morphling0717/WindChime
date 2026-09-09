"use client";
import { useEffect, useRef, useState } from "react";
import type {
  WindChimeRateLimit,
  WindChimeSubmitPayload,
} from "../core/index.js";
import {
  normalizeWindChimeTerms,
  matchWindChimeBlockedTerm,
  validateWindChimeSubmission,
} from "../core/index.js";
import {
  WindChimeClientError,
  asWindChimeClientError,
  type WindChimeClient,
} from "../client/index.js";

export type WindChimeSubmissionOptions = {
  client?: WindChimeClient;
  onSubmit?: (payload: WindChimeSubmitPayload) => Promise<unknown>;
  topicSlug?: string;
  enabled?: boolean;
  requireTurnstile?: boolean;
  rateLimit?: WindChimeRateLimit | false;
  senderFingerprintKey?: string;
  disableSenderFingerprint?: boolean;
  maxLength?: number;
  nicknameMaxLength?: number;
  linkMaxLength?: number;
  blockedTerms?: string[];
};
function readStamps(key: string): number[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter(
          (value): value is number =>
            typeof value === "number" && Number.isFinite(value),
        )
      : [];
  } catch {
    return [];
  }
}
export function ensureWindChimeFingerprint(
  key = "windchime:fp",
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = localStorage.getItem(key);
    if (existing && existing.length >= 16) return existing;
    if (!globalThis.crypto?.getRandomValues) return null;
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const fingerprint = [...bytes]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem(key, fingerprint);
    return fingerprint;
  } catch {
    return null;
  }
}
export function normalizeWindChimeLink(raw: string): string | null {
  try {
    return (
      validateWindChimeSubmission({ text: "_", linkUrl: raw }).linkUrl ?? null
    );
  } catch {
    return null;
  }
}
export function useWindChimeSubmission(options: WindChimeSubmissionOptions) {
  const [text, setText] = useState("");
  const [nickname, setNickname] = useState("");
  const [linkRaw, setLinkRaw] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<WindChimeClientError | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(0);
  const busy = useRef(false);
  const scope = options.topicSlug ?? "default";
  const liveScope = useRef(scope);
  const revision = useRef(0);
  if (liveScope.current !== scope) {
    liveScope.current = scope;
    ++revision.current;
  }
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setSuccess(false);
    setError(null);
    setTurnstileToken(null);
  }, [scope]);
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= cooldownUntil) {
        setCooldownUntil(0);
        clearInterval(timer);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [cooldownUntil]);
  const retryAfterMs = Math.max(0, cooldownUntil - (clock || Date.now()));
  const maxLength = options.maxLength ?? 1000,
    nicknameMaxLength = options.nicknameMaxLength ?? 32,
    linkMaxLength = options.linkMaxLength ?? 500;
  const canSubmit =
    options.enabled !== false &&
    text.trim().length > 0 &&
    text.length <= maxLength &&
    nickname.length <= nicknameMaxLength &&
    linkRaw.length <= linkMaxLength &&
    (!options.requireTurnstile || !!turnstileToken) &&
    !sending &&
    retryAfterMs === 0;
  const clearSuccess = () => setSuccess(false);
  const reset = () => {
    setText("");
    setNickname("");
    setLinkRaw("");
    setTurnstileToken(null);
    setError(null);
    setSuccess(false);
  };
  async function submit(): Promise<boolean> {
    if (busy.current) return false;
    const generation = revision.current;
    setError(null);
    setSuccess(false);
    try {
      if (options.enabled === false)
        throw new WindChimeClientError("SUBMISSIONS_CLOSED");
      if (!text.trim()) throw new WindChimeClientError("TEXT_REQUIRED");
      if (text.length > maxLength)
        throw new WindChimeClientError("TEXT_TOO_LONG");
      if (nickname.length > nicknameMaxLength)
        throw new WindChimeClientError("NICKNAME_TOO_LONG");
      if (linkRaw.length > linkMaxLength)
        throw new WindChimeClientError("LINK_TOO_LONG");
      if (options.requireTurnstile && !turnstileToken)
        throw new WindChimeClientError("TURNSTILE_REQUIRED");
      const linkUrl = normalizeWindChimeLink(linkRaw);
      if (linkRaw.trim() && !linkUrl)
        throw new WindChimeClientError("INVALID_LINK");
      if (
        matchWindChimeBlockedTerm(
          normalizeWindChimeTerms(options.blockedTerms ?? []),
          text,
          nickname,
        )
      )
        throw new WindChimeClientError("BLOCKED_TERM");
      const now = Date.now(),
        rateLimit =
          options.rateLimit === false ? null : (options.rateLimit ?? {});
      const key = rateLimit?.storageKey ?? "windchime:rl",
        windowMs = rateLimit?.windowMs ?? 60_000;
      const stamps = rateLimit
        ? readStamps(key)
            .filter((stamp) => stamp > now - windowMs)
            .sort((a, b) => a - b)
        : [];
      if (rateLimit && stamps.length >= (rateLimit.max ?? 3))
        throw new WindChimeClientError(
          "RATE_LIMITED",
          429,
          "RATE_LIMITED",
          Math.max(0, stamps[0]! + windowMs - now),
        );
      if (retryAfterMs > 0)
        throw new WindChimeClientError(
          "RATE_LIMITED",
          429,
          "RATE_LIMITED",
          retryAfterMs,
        );
      busy.current = true;
      setSending(true);
      const payload: WindChimeSubmitPayload = validateWindChimeSubmission(
        {
          text: text.trim(),
          nickname: nickname.trim() || null,
          linkUrl,
          topicSlug: options.topicSlug,
          turnstileToken: options.requireTurnstile ? turnstileToken : null,
          senderFingerprint: options.disableSenderFingerprint
            ? null
            : ensureWindChimeFingerprint(options.senderFingerprintKey),
        },
        { maxLength, nicknameMaxLength, linkMaxLength },
      );
      const send = options.onSubmit ?? options.client?.messages.submit;
      if (!send) throw new WindChimeClientError("SUBMIT_HANDLER_REQUIRED");
      await send(payload);
      if (rateLimit) {
        try {
          localStorage.setItem(
            key,
            JSON.stringify([
              ...readStamps(key).filter(
                (stamp) => stamp > Date.now() - windowMs,
              ),
              Date.now(),
            ]),
          );
        } catch {
          /* Storage is an optional client hint, server rate limiting remains authoritative. */
        }
      }
      if (
        mounted.current &&
        liveScope.current === scope &&
        revision.current === generation
      ) {
        setText("");
        setNickname("");
        setLinkRaw("");
        setTurnstileToken(null);
        setSuccess(true);
      }
      return true;
    } catch (cause) {
      const failure = asWindChimeClientError(cause);
      if (
        mounted.current &&
        liveScope.current === scope &&
        revision.current === generation
      ) {
        setError(failure);
        setTurnstileToken(null);
        if (failure.retryAfterMs) {
          const now = Date.now();
          setClock(now);
          setCooldownUntil(now + failure.retryAfterMs);
        }
      }
      return false;
    } finally {
      busy.current = false;
      if (mounted.current) setSending(false);
    }
  }
  return {
    text,
    setText,
    nickname,
    setNickname,
    linkRaw,
    setLinkRaw,
    turnstileToken,
    setTurnstileToken,
    canSubmit,
    submit,
    sending,
    success,
    error,
    reset,
    clearSuccess,
    retryAfterMs,
  };
}
