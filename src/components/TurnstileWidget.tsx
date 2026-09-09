"use client";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { useWindChimeTurnstile } from "../react/turnstile.js";
export type TurnstileWidgetHandle = { reset: () => void };
export type TurnstileWidgetProps = {
  siteKey: string;
  onToken: (token: string | null) => void;
  onExpire?: () => void;
  className?: string;
};
export const TurnstileWidget = forwardRef<
  TurnstileWidgetHandle,
  TurnstileWidgetProps
>(function TurnstileWidget({ siteKey, onToken, onExpire, className }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const challenge = useWindChimeTurnstile(containerRef, {
    siteKey,
    onToken,
    onExpire,
  });
  useImperativeHandle(ref, () => ({ reset: challenge.reset }), [
    challenge.reset,
  ]);
  return <div ref={containerRef} className={className} data-turnstile-host />;
});
TurnstileWidget.displayName = "TurnstileWidget";
