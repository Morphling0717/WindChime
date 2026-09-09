"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { WindChimeClientError } from "../client/index.js";
const SCRIPT_BASE = "https://challenges.cloudflare.com/turnstile/v0/api.js";
let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      `script[src^="${SCRIPT_BASE}"]`,
    );
    const created = !script;
    if (!script) {
      script = document.createElement("script");
      script.src = `${SCRIPT_BASE}?render=explicit`;
      script.async = true;
    }
    const node = script;
    const timer = setTimeout(
      () => done(new Error("TURNSTILE_LOAD_TIMEOUT")),
      15000,
    );
    function done(error?: Error) {
      clearTimeout(timer);
      node.removeEventListener("load", success);
      node.removeEventListener("error", failure);
      if (error) {
        if (created) node.remove();
        reject(error);
      } else resolve();
    }
    function success() {
      done(window.turnstile ? undefined : new Error("TURNSTILE_UNAVAILABLE"));
    }
    function failure() {
      done(new Error("TURNSTILE_LOAD_FAILED"));
    }
    node.addEventListener("load", success, { once: true });
    node.addEventListener("error", failure, { once: true });
    if (created) document.head.appendChild(node);
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}
export type WindChimeTurnstileOptions = {
  siteKey?: string;
  theme?: "auto" | "light" | "dark";
  onToken?: (token: string | null) => void;
  onExpire?: () => void;
};
export function useWindChimeTurnstile(
  containerRef: RefObject<HTMLElement | null>,
  options: WindChimeTurnstileOptions,
) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<WindChimeClientError | null>(null);
  const [isLoading, setLoading] = useState(false);
  const publish = useCallback((value: string | null) => {
    setToken(value);
    callbacks.current.onToken?.(value);
  }, []);
  const reset = useCallback(() => {
    if (widget.current && window.turnstile) {
      try {
        window.turnstile.reset(widget.current);
      } catch {
        /* A removed widget has nothing to reset. */
      }
    }
    publish(null);
  }, [publish]);
  useEffect(() => {
    if (!options.siteKey) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    publish(null);
    void loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widget.current = window.turnstile.render(containerRef.current, {
          sitekey: options.siteKey!,
          theme: options.theme ?? "auto",
          callback: (value: string) => {
            if (!cancelled) {
              setError(null);
              publish(value);
            }
          },
          "expired-callback": () => {
            if (!cancelled) {
              publish(null);
              callbacks.current.onExpire?.();
            }
          },
          "error-callback": () => {
            if (!cancelled) {
              publish(null);
              setError(new WindChimeClientError("TURNSTILE_FAILED"));
            }
          },
        });
      })
      .catch((cause) => {
        if (!cancelled) {
          publish(null);
          setError(
            new WindChimeClientError(
              "TURNSTILE_FAILED",
              0,
              cause instanceof Error ? cause.message : "TURNSTILE_FAILED",
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) {
        try {
          window.turnstile.remove(widget.current);
        } catch {
          /* Removed by host navigation. */
        }
        widget.current = null;
      }
    };
  }, [containerRef, options.siteKey, options.theme, publish]);
  return { token, error, isLoading, reset };
}
