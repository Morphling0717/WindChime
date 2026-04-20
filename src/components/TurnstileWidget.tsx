'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useCallback,
} from 'react';

export type TurnstileWidgetHandle = { reset: () => void };

const SCRIPT_BASE = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

function scriptSrcExplicit() {
  return `${SCRIPT_BASE}?render=explicit`;
}

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_BASE}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      const done = () => (window.turnstile ? resolve() : reject(new Error('Turnstile unavailable')));
      if (window.turnstile) {
        resolve();
        return;
      }
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener('error', () => reject(new Error('Turnstile script failed')), {
        once: true,
      });
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = scriptSrcExplicit();
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Turnstile script failed'));
    document.head.appendChild(s);
  });
}

type TurnstileWidgetProps = {
  siteKey: string;
  onToken: (token: string | null) => void;
  onExpire?: () => void;
  className?: string;
};

export const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ siteKey, onToken, onExpire, className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);

    const reset = useCallback(() => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetIdRef.current);
        } catch {
          /* ignore */
        }
      }
      onToken(null);
    }, [onToken]);

    useImperativeHandle(ref, () => ({ reset }), [reset]);

    useEffect(() => {
      let cancelled = false;
      void (async () => {
        try {
          await loadTurnstileScript();
        } catch {
          onToken(null);
          return;
        }
        if (cancelled || !containerRef.current || !window.turnstile) return;
        try {
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            callback: (token: string) => onToken(token),
            'expired-callback': () => {
              onToken(null);
              onExpire?.();
            },
            'error-callback': () => onToken(null),
          });
        } catch {
          onToken(null);
        }
      })();
      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            /* ignore */
          }
          widgetIdRef.current = null;
        }
      };
    }, [siteKey, onToken, onExpire]);

    return <div ref={containerRef} className={className} data-turnstile-host />;
  },
);

TurnstileWidget.displayName = 'TurnstileWidget';
