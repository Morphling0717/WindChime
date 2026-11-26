'use client';
import { useEffect, useRef, useState, type WheelEvent } from 'react';
import type { WindChimeLiveClient } from '../client/live.js';
import type { WindChimeLiveMessage } from '../core/live.js';
import type {
  WindChimeDisplayScrollCommand,
  WindChimeDisplayScrollMetrics,
} from './scroll-loop.js';

export function OnAirTeleprompter({
  client,
  topicId,
  message,
  scrollState,
  onScrollDisplay,
  compact = false,
}: {
  client?: WindChimeLiveClient;
  topicId?: string;
  message: WindChimeLiveMessage | null;
  scrollState?: WindChimeDisplayScrollMetrics | null;
  onScrollDisplay: (command: WindChimeDisplayScrollCommand) => Promise<void> | void;
  compact?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const lastLocalAt = useRef(0);
  const pendingRatio = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);
  const [fontSize, setFontSize] = useState(16);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [zoomed, setZoomed] = useState<{ url: string; caption: string } | null>(null);

  const send = (command: WindChimeDisplayScrollCommand) => {
    void Promise.resolve(onScrollDisplay(command)).catch(() => {});
  };

  useEffect(() => {
    return () => {
      if (rafId.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  // Reset local teleprompter scroll and close lightbox when the on-air message changes.
  useEffect(() => {
    setZoomed(null);
    const el = boxRef.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTop = 0;
    lastLocalAt.current = 0;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { programmatic.current = false; });
    } else {
      programmatic.current = false;
    }
  }, [message?.id, message?.snapshotId]);

  // Load attached image thumbnails for the on-air message when available.
  const assetIdsSignature = message ? message.draft.assets.map(asset => asset.id).join('|') : '';
  useEffect(() => {
    if (
      !message ||
      !assetIdsSignature ||
      !client ||
      typeof client.asset !== 'function' ||
      !topicId ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      setAssetUrls({});
      return;
    }
    const ids = [...new Set(assetIdsSignature.split('|').filter(Boolean))];
    let cancelled = false;
    const controller = new AbortController();
    const owned = new Set<string>();
    const release = () => {
      cancelled = true;
      controller.abort();
      owned.forEach(url => URL.revokeObjectURL(url));
      owned.clear();
    };
    setAssetUrls({});
    void Promise.allSettled(
      ids.map(async id => {
        const blob = await client.asset(topicId, id, controller.signal);
        if (
          !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) ||
          blob.size > 5 * 1024 * 1024
        ) {
          throw new Error('图片格式无效');
        }
        if (cancelled || controller.signal.aborted) throw new Error('cancelled');
        const url = URL.createObjectURL(blob);
        owned.add(url);
        return [id, url] as const;
      }),
    ).then(results => {
      if (cancelled) return;
      const entries = results.flatMap(item => (item.status === 'fulfilled' ? [item.value] : []));
      setAssetUrls(Object.fromEntries(entries));
    });
    return release;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, topicId, message?.id, assetIdsSignature]);

  // Close zoomed lightbox with Escape key.
  useEffect(() => {
    if (!zoomed || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoomed(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomed]);

  // Follow external scroll updates (auto-scroll, hotkeys, or another private window).
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !scrollState) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastLocalAt.current < 220) return;
    const localMax = el.scrollHeight - el.clientHeight;
    if (localMax <= 1) return;
    const desired = scrollState.ratio * localMax;
    if (Math.abs(el.scrollTop - desired) <= 1.5) return;
    programmatic.current = true;
    el.scrollTop = desired;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { programmatic.current = false; });
    } else {
      programmatic.current = false;
    }
  }, [scrollState?.ratio, scrollState?.offset, scrollState?.maximum]);

  if (!message) {
    return (
      <section className={`wc-panel wc-teleprompter${compact ? ' is-compact' : ''}`} aria-label="在播提词同步">
        <div className="wc-panel-head">
          <h3>在播提词同步</h3>
          <span className="wc-muted">画面为空白</span>
        </div>
        <p className="wc-teleprompter-empty">
          上屏后可在此直接用滚轮边读边滑，1:1 实时同步观众展示窗，无需切去操作展示窗。
        </p>
      </section>
    );
  }

  const canScroll = Boolean(scrollState && scrollState.maximum > 1);
  const ratio = scrollState ? Math.min(1, Math.max(0, scrollState.ratio)) : 0;
  const percent = Math.round(ratio * 100);
  const isAutoRunning = Boolean(canScroll && scrollState && !scrollState.paused);

  const scheduleRatio = (nextRatio: number) => {
    pendingRatio.current = nextRatio;
    if (rafId.current !== null) return;
    const flush = () => {
      rafId.current = null;
      if (pendingRatio.current === null) return;
      const value = pendingRatio.current;
      pendingRatio.current = null;
      send({ type: 'ratio', ratio: value });
    };
    if (typeof requestAnimationFrame === 'function') {
      rafId.current = requestAnimationFrame(flush);
    } else {
      flush();
    }
  };

  const handleScroll = () => {
    if (programmatic.current) return;
    const el = boxRef.current;
    if (!el) return;
    const localMax = el.scrollHeight - el.clientHeight;
    if (localMax <= 1) return;
    lastLocalAt.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    scheduleRatio(Math.min(1, Math.max(0, el.scrollTop / localMax)));
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const el = boxRef.current;
    if (!el) return;
    const localMax = el.scrollHeight - el.clientHeight;
    // If local reading text fits without a scrollbar while the larger audience
    // card overflows, forward mouse wheel directly to the audience display.
    if (localMax <= 2 && canScroll && Math.abs(event.deltaY) > 0) {
      event.preventDefault();
      lastLocalAt.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const delta = Math.max(-0.85, Math.min(0.85, event.deltaY / 240));
      send({ type: 'step', delta });
    }
  };

  const handleScrub = (value: number) => {
    const nextRatio = Math.min(1, Math.max(0, value / 1000));
    lastLocalAt.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const el = boxRef.current;
    if (el) {
      const localMax = el.scrollHeight - el.clientHeight;
      if (localMax > 1) {
        programmatic.current = true;
        el.scrollTop = nextRatio * localMax;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => { programmatic.current = false; });
        } else {
          programmatic.current = false;
        }
      }
    }
    send({ type: 'ratio', ratio: nextRatio });
  };

  const step = (delta: number) => {
    lastLocalAt.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    send({ type: 'step', delta });
  };

  const captions = message.draft.assets
    .map((asset, index) => (asset.caption ? `图片 ${index + 1} · ${asset.caption}` : ''))
    .filter(Boolean);
  const mediaItems = message.draft.assets.map((asset, index) => ({
    id: asset.id,
    caption: asset.caption || `附图 ${index + 1}`,
    url: assetUrls[asset.id] || '',
  }));

  return (
    <section className={`wc-panel wc-teleprompter${compact ? ' is-compact' : ''}`} aria-label="在播提词同步">
      <div className="wc-panel-head wc-teleprompter-head">
        <div className="wc-teleprompter-title">
          <span className="wc-tag approved">正在播出</span>
          <strong>{message.draft.nickname || '匿名来信'}</strong>
        </div>
        <div className="wc-teleprompter-meta">
          <span className="wc-muted" role="status">
            {!canScroll
              ? '一屏完整可见'
              : isAutoRunning
                ? `自动滚动 · ${percent}%`
                : `手动控制 · ${percent}%`}
          </span>
          <div className="wc-teleprompter-size" role="group" aria-label="提词字号">
            <button
              type="button"
              className="wc-queue-small"
              aria-label="减小提词字号"
              disabled={fontSize <= 13}
              onClick={() => setFontSize(size => Math.max(13, size - 2))}
            >
              A-
            </button>
            <button
              type="button"
              className="wc-queue-small"
              aria-label="增大提词字号"
              disabled={fontSize >= 24}
              onClick={() => setFontSize(size => Math.min(24, size + 2))}
            >
              A+
            </button>
          </div>
        </div>
      </div>

      <div
        ref={boxRef}
        className="wc-teleprompter-text"
        style={{ fontSize }}
        tabIndex={0}
        aria-label="在播信件提词内容，滚动滑轮可同步观众画面"
        onScroll={handleScroll}
        onWheel={handleWheel}
      >
        <div className="wc-teleprompter-copy">{message.draft.text}</div>
        {message.draft.linkUrl ? (
          <div className="wc-teleprompter-extra">外链：{message.draft.linkUrl}</div>
        ) : null}
        {captions.length ? (
          <div className="wc-teleprompter-extra">{captions.join('\n')}</div>
        ) : null}
      </div>

      {mediaItems.length > 0 ? (
        <div className="wc-teleprompter-media" aria-label="在播附图预览">
          {mediaItems.map((item, index) => (
            <button
              key={`${item.id}-${index}`}
              type="button"
              className="wc-teleprompter-thumb"
              disabled={!item.url}
              title={item.url ? `查看大图：${item.caption}` : '图片载入中'}
              aria-label={`放大查看附图 ${index + 1}`}
              onClick={() => { if (item.url) setZoomed({ url: item.url, caption: item.caption }); }}
            >
              {item.url ? (
                <img src={item.url} alt={item.caption} />
              ) : (
                <span className="wc-muted">载入中…</span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      <div className="wc-teleprompter-controls">
        <label className="wc-teleprompter-slider">
          <span className="wc-muted">进度</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(ratio * 1000)}
            disabled={!canScroll}
            aria-label="观众画面滚动进度"
            onChange={event => handleScrub(Number(event.currentTarget.value))}
          />
          <span className="wc-teleprompter-pct">{canScroll ? `${percent}%` : '—'}</span>
        </label>
        <div className="wc-actions">
          <button type="button" className="wc-queue-small" disabled={!canScroll} onClick={() => step(-0.45)}>
            ↑ 上翻
          </button>
          <button type="button" className="wc-queue-small" disabled={!canScroll} onClick={() => step(0.45)}>
            ↓ 下翻
          </button>
          <button
            type="button"
            className="wc-queue-small"
            disabled={!canScroll}
            onClick={() => send({ type: 'togglePause' })}
          >
            {isAutoRunning ? '⏸ 暂停滚动' : '▶ 自动滚动'}
          </button>
          <button
            type="button"
            className="wc-queue-small"
            disabled={!canScroll}
            onClick={() => {
              lastLocalAt.current = 0;
              send({ type: 'top' });
            }}
          >
            ⤒ 回顶部
          </button>
        </div>
      </div>

      {zoomed ? (
        <div
          className="wc-teleprompter-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="附图大图预览"
          onClick={() => setZoomed(null)}
        >
          <div className="wc-teleprompter-lightbox-card" onClick={event => event.stopPropagation()}>
            <img src={zoomed.url} alt={zoomed.caption} />
            <div className="wc-teleprompter-lightbox-foot">
              <span>{zoomed.caption}</span>
              <button type="button" onClick={() => setZoomed(null)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
