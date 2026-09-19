'use client';
import { Component, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { WindChimeDisplayClient } from '../client/live.js';
import type { WindChimeLiveAppearance, WindChimeLiveAsset, WindChimeLiveSnapshot } from '../core/live.js';
import { WindChimeDisplayReceiver, type WindChimeDisplayValue } from './receiver.js';
import { resolveLiveLayout } from './appearance.js';
import { windChimeDisplayCss } from './display-styles.js';
import { startDisplayScroll } from './scroll-loop.js';

export type WindChimeLiveRenderProps = { snapshot: WindChimeLiveSnapshot; appearance: WindChimeLiveAppearance; assetUrls: Readonly<Record<string, string>> };
const metric = (value: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value!)) : fallback;

function ScrollingLetter({ snapshot, appearance, assetUrls }: WindChimeLiveRenderProps) {
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!viewport.current || !content.current || typeof requestAnimationFrame !== 'function') return;
    return startDisplayScroll(viewport.current, content.current, {
      enabled: appearance.autoScroll ?? true,
      speed: metric(appearance.scrollSpeed, 24, 5, 120),
      startPauseMs: metric(appearance.scrollStartPauseMs, 2000, 0, 15000),
      endPauseMs: metric(appearance.scrollEndPauseMs, 2500, 0, 15000),
    });
  }, []); // The parent remounts this subtree whenever the approved content or appearance changes.
  return <div className="wc-display-viewport" ref={viewport} data-scroll-phase="top">
    <div className="wc-display-grid" ref={content}>
      {snapshot.nickname ? <div className="wc-display-author">{snapshot.nickname}</div> : null}
      <div className="wc-display-copy">
        <div className="wc-display-text">{snapshot.text}</div>
        {snapshot.linkUrl ? <div className="wc-display-link">{snapshot.linkUrl}</div> : null}
      </div>
      {snapshot.assets.length ? <div className="wc-display-media" data-arrangement={appearance.imageLayout ?? 'column'}>
        {(snapshot.assets as WindChimeLiveAsset[]).map(asset => assetUrls[asset.id] ? <figure key={asset.id}>
          <img src={assetUrls[asset.id]} alt={asset.caption} width={asset.width} height={asset.height} />
          {asset.caption ? <figcaption>{asset.caption}</figcaption> : null}
        </figure> : null)}
      </div> : null}
    </div>
  </div>;
}
export function WindChimeLiveCard({ snapshot, appearance, assetUrls }: WindChimeLiveRenderProps) {
  const theme = appearance.theme ?? 'pure';
  const style: CSSProperties = {
    ...{
      '--wc-display-ink': appearance.textColor,
      '--wc-display-fill': appearance.transparent ? 'transparent' : appearance.backgroundColor,
      '--wc-display-font': appearance.fontFamily,
      '--wc-display-size': `${metric(appearance.fontSize, 32, 12, 96)}px`,
      '--wc-display-padding': `${metric(appearance.padding, 32, 0, 100)}px`,
      '--wc-display-radius': `${metric(appearance.borderRadius, 24, 0, 100)}px`,
      '--wc-display-border': `${metric(appearance.borderWidth, 0, 0, 8)}px`,
      '--wc-display-accent': appearance.accentColor ?? '#2de2e6',
      '--wc-display-leading': metric(appearance.lineHeight, 1.65, 1.1, 2.4),
      '--wc-display-tracking': `${metric(appearance.letterSpacing, 0, -1, 6)}px`,
    } as CSSProperties,
    width: metric(appearance.maxWidth, 1200, 280, 1920),
    height: metric(appearance.viewportHeight, 640, 180, 1080),
    animation: appearance.animation === 'none' ? undefined : `wc-display-${appearance.animation} .3s ease-out both`,
  };
  return <article className="wc-display" style={style} data-windchime-snapshot={snapshot.id} data-theme={theme} data-layout={resolveLiveLayout(appearance.layout)} data-filled={!appearance.transparent} data-has-media={snapshot.assets.length > 0} data-has-author={!!snapshot.nickname}>
    <style>{windChimeDisplayCss}</style>
    {theme === 'uliuli' ? <>
      <i className="wc-display-ornament wc-display-corner wc-display-corner-a" aria-hidden="true" />
      <i className="wc-display-ornament wc-display-corner wc-display-corner-b" aria-hidden="true" />
      <svg className="wc-display-ornament wc-display-orbit" viewBox="0 0 140 140" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="70" cy="70" r="56" /><circle cx="70" cy="70" r="39" strokeDasharray="3 9" /><path d="M70 2v24m0 88v24M2 70h24m88 0h24M35 35l70 70M35 105l70-70" /></svg>
    </> : theme === 'mia' ? <>
      <i className="wc-display-ornament wc-display-inner-frame" aria-hidden="true" />
      <svg className="wc-display-ornament wc-display-arch" viewBox="0 0 90 122" fill="none" stroke="currentColor" aria-hidden="true"><path d="M9 120V47a36 36 0 0 1 72 0v73M18 120V47a27 27 0 0 1 54 0v73M45 12v108M9 62h72M9 94h72" /></svg>
      <svg className="wc-display-ornament wc-display-star" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M8 0v16M0 8h16M3 3l10 10M3 13 13 3" /></svg>
    </> : null}
    <ScrollingLetter key={JSON.stringify([snapshot, appearance, assetUrls])} snapshot={snapshot} appearance={appearance} assetUrls={assetUrls} />
  </article>;
}
class BlankOnError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}
/** Capture only this isolated output. No login, notification or error UI is rendered. */
export function WindChimeLiveDisplay({ client, render, pollIntervalMs = 1000 }: { client: WindChimeDisplayClient; render?: (props: WindChimeLiveRenderProps) => ReactNode; pollIntervalMs?: number }) {
  const [received, setReceived] = useState<{ client: WindChimeDisplayClient; value: WindChimeDisplayValue } | null>(null);
  // A caller changing accounts/credentials must not paint the previous client's
  // frame while React is waiting to run the effect cleanup.
  const value = received?.client === client ? received.value : null;
  useEffect(() => {
    const receiver = new WindChimeDisplayReceiver(client, { pollIntervalMs });
    receiver.start(value => setReceived({ client, value }));
    const reset = () => receiver.reset();
    const restore = (event: PageTransitionEvent) => { if (event.persisted) reset(); };
    window.addEventListener('offline', reset); window.addEventListener('pagehide', reset); window.addEventListener('pageshow', restore);
    document.addEventListener('freeze', reset); document.addEventListener('resume', reset);
    return () => { receiver.stop(); window.removeEventListener('offline', reset); window.removeEventListener('pagehide', reset); window.removeEventListener('pageshow', restore); document.removeEventListener('freeze', reset); document.removeEventListener('resume', reset); };
  }, [client, pollIntervalMs]);
  const snapshot = value?.frame.snapshot;
  if (!value || !snapshot) return null;
  const props = { snapshot, appearance: value.frame.appearance, assetUrls: value.assetUrls };
  return <BlankOnError key={`${value.frame.epoch}:${value.frame.activation}`}>{render ? render(props) : <WindChimeLiveCard {...props} />}</BlankOnError>;
}
