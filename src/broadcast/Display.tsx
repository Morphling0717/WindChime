'use client';
import { Component, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { WindChimeDisplayClient } from '../client/live.js';
import type { WindChimeLiveAppearance, WindChimeLiveSnapshot } from '../core/live.js';
import { WindChimeDisplayReceiver, type WindChimeDisplayValue } from './receiver.js';

export type WindChimeLiveRenderProps = { snapshot: WindChimeLiveSnapshot; appearance: WindChimeLiveAppearance; assetUrls: Readonly<Record<string, string>> };
export function WindChimeLiveCard({ snapshot, appearance, assetUrls }: WindChimeLiveRenderProps) {
  const style: CSSProperties = {
    color: appearance.textColor, background: appearance.transparent ? 'transparent' : appearance.backgroundColor,
    fontFamily: appearance.fontFamily, fontSize: appearance.fontSize, padding: appearance.padding,
    borderRadius: appearance.borderRadius, boxSizing: 'border-box', maxWidth: '100%', overflowWrap: 'anywhere',
    lineHeight: 1.65, whiteSpace: 'pre-wrap',
    ...(appearance.layout === 'letter' ? { borderLeft: '3px solid currentColor', borderRadius: 0 } : {}),
    ...(appearance.layout === 'minimal' ? { padding: 8, borderRadius: 0 } : {}),
    animation: appearance.animation === 'none' ? undefined : `wc-display-${appearance.animation} .3s ease-out both`,
  };
  return <article style={style} data-windchime-snapshot={snapshot.id}>
    <style>{'@keyframes wc-display-fade{from{opacity:0}to{opacity:1}}@keyframes wc-display-slide{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){[data-windchime-snapshot]{animation:none!important}}'}</style>
    {snapshot.nickname ? <div style={{ fontSize: '.58em', letterSpacing: '.04em', opacity: .75, marginBottom: '.7em' }}>{snapshot.nickname}</div> : null}
    <div>{snapshot.text}</div>
    {snapshot.linkUrl ? <div style={{ fontSize: '.5em', opacity: .7, marginTop: '1em', wordBreak: 'break-all' }}>{snapshot.linkUrl}</div> : null}
    {snapshot.assets.length ? <div style={{ display: appearance.imageLayout === 'grid' ? 'grid' : 'flex', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', flexDirection: appearance.imageLayout === 'column' ? 'column' : 'row', flexWrap: 'wrap', gap: 16, marginTop: 20 }}>
      {snapshot.assets.map(asset => assetUrls[asset.id] ? <figure key={asset.id} style={{ margin: 0, maxWidth: '100%', flex: appearance.imageLayout === 'column' ? undefined : '1 1 220px' }}>
        <img src={assetUrls[asset.id]} alt={asset.caption} style={{ maxWidth: '100%', maxHeight: '55vh', objectFit: 'contain', display: 'block', borderRadius: Math.min(appearance.borderRadius, 12) }} />
        {asset.caption ? <figcaption style={{ fontSize: '.5em', marginTop: 8 }}>{asset.caption}</figcaption> : null}
      </figure> : null)}
    </div> : null}
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
