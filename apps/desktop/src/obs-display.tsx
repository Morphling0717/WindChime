import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_WINDCHIME_LIVE_APPEARANCE,
  type WindChimeLiveAppearance,
  type WindChimeLiveSnapshot,
} from '../../../src/core/live';
import { WindChimeLiveCard, type WindChimeLocalOverlay } from '../../../src/broadcast/Display';
import type {
  WindChimeDisplayScrollCommand,
  WindChimeDisplayScrollMetrics,
} from '../../../src/broadcast/scroll-loop';

function buildObsTestCard(width: number, height: number): WindChimeLiveSnapshot {
  return {
    id: 'windchime-local-test-card',
    messageId: 'windchime-local-test-card',
    nickname: `对位测试卡 · OBS 浏览器源（${width} × ${height}）`,
    text:
      'OBS 浏览器源已连接成功！画面会自动 100% 铺满你在 OBS 设置的宽高：\n' +
      '• 自由拉长 / 拉宽 / 改竖屏（文字不变形）：在 OBS 双击此浏览器源，直接改「宽度 / 高度」即可。\n' +
      '• 调整位置与等比缩放：在 OBS 预览区直接拖动红框或拉动四角。\n\n' +
      '对位完成后点击控制台「关闭测试卡」即恢复透明空白待机（正式来信不会显示虚线边框）。',
    linkUrl: null,
    assets: [],
  };
}

type FramePayload = {
  snapshot: WindChimeLiveSnapshot;
  appearance: WindChimeLiveAppearance | null;
  activation?: number;
  epoch?: string;
  basePath?: string;
};

function resolveBasePath(): string {
  const meta = document.querySelector('meta[name="windchime-obs-base"]')?.getAttribute('content');
  if (meta && meta.startsWith('/obs/')) return meta.replace(/\/$/, '');
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[0] === 'obs') return `/obs/${parts[1]}`;
  return '';
}

function ObsOutput() {
  const basePath = useMemo(() => resolveBasePath(), []);
  const [frame, setFrame] = useState<FramePayload | null>(null);
  const [testCard, setTestCard] = useState<{ active: boolean; appearance: WindChimeLiveAppearance | null }>({
    active: false,
    appearance: null,
  });
  const [overlay, setOverlay] = useState<WindChimeLocalOverlay | null>(null);
  const [spotlightAssetId, setSpotlightAssetId] = useState<string | null>(null);
  const [displayMotion, setDisplayMotion] = useState(true);
  const [viewport, setViewport] = useState(() => ({ width: Math.round(window.innerWidth || 0), height: Math.round(window.innerHeight || 0) }));
  const scrollListeners = useRef(new Set<(cmd: WindChimeDisplayScrollCommand) => void>());
  const lastReportRef = useRef(0);
  const pendingMetricsRef = useRef<WindChimeDisplayScrollMetrics | null | undefined>(undefined);
  const metricsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSnapshotIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (metricsTimerRef.current !== null) {
        clearTimeout(metricsTimerRef.current);
        metricsTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const syncSize = () => setViewport({ width: Math.round(window.innerWidth || 0), height: Math.round(window.innerHeight || 0) });
    syncSize();
    window.addEventListener('resize', syncSize);
    return () => window.removeEventListener('resize', syncSize);
  }, []);

  useEffect(() => {
    if (!basePath) return;
    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 600;

    const connect = () => {
      if (disposed) return;
      source = new EventSource(`${basePath}/events`);
      source.onopen = () => {
        retryDelay = 600;
      };
      source.addEventListener('frame', ev => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as FramePayload;
          if (payload?.snapshot) {
            const changed = currentSnapshotIdRef.current !== payload.snapshot.id;
            currentSnapshotIdRef.current = payload.snapshot.id;
            setTestCard({ active: false, appearance: null });
            if (changed) setSpotlightAssetId(null);
            setFrame(payload);
          }
        } catch {}
      });
      source.addEventListener('blank', () => {
        currentSnapshotIdRef.current = null;
        setSpotlightAssetId(null);
        setFrame(null);
        setTestCard({ active: false, appearance: null });
      });
      source.addEventListener('test-card', ev => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as { active: boolean; appearance?: WindChimeLiveAppearance | null };
          setTestCard({ active: Boolean(payload?.active), appearance: payload?.appearance ?? null });
        } catch {}
      });
      source.addEventListener('overlay', ev => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as WindChimeLocalOverlay;
          setOverlay(payload ?? null);
        } catch {}
      });
      source.addEventListener('spotlight', ev => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as { assetId?: string | null };
          setSpotlightAssetId(typeof payload?.assetId === 'string' && payload.assetId ? payload.assetId : null);
        } catch {}
      });
      source.addEventListener('motion', ev => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as { enabled?: boolean };
          setDisplayMotion(payload?.enabled !== false);
        } catch {}
      });
      source.addEventListener('scroll', ev => {
        try {
          const cmd = JSON.parse((ev as MessageEvent).data) as WindChimeDisplayScrollCommand;
          for (const handler of scrollListeners.current) handler(cmd);
        } catch {}
      });
      source.onerror = () => {
        // Fail closed immediately whenever the local bridge drops or resets.
        currentSnapshotIdRef.current = null;
        setSpotlightAssetId(null);
        setFrame(null);
        setTestCard({ active: false, appearance: null });
        source?.close();
        source = null;
        if (!disposed) {
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(4000, retryDelay * 1.5);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [basePath]);

  const scrollControl = useMemo(() => {
    const flushMetrics = (payload: WindChimeDisplayScrollMetrics | null) => {
      if (!basePath) return;
      lastReportRef.current = Date.now();
      void fetch(`${basePath}/scroll-metrics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    };
    return {
      subscribe: (handler: (cmd: WindChimeDisplayScrollCommand) => void) => {
        scrollListeners.current.add(handler);
        return () => { scrollListeners.current.delete(handler); };
      },
      onMetrics: (metrics: WindChimeDisplayScrollMetrics | null) => {
        if (!basePath) return;
        if (metrics === null) {
          pendingMetricsRef.current = undefined;
          if (metricsTimerRef.current !== null) {
            clearTimeout(metricsTimerRef.current);
            metricsTimerRef.current = null;
          }
          flushMetrics(null);
          return;
        }
        const elapsed = Date.now() - lastReportRef.current;
        if (elapsed >= 160 && metricsTimerRef.current === null) {
          flushMetrics(metrics);
          return;
        }
        pendingMetricsRef.current = metrics;
        if (metricsTimerRef.current === null) {
          metricsTimerRef.current = setTimeout(() => {
            metricsTimerRef.current = null;
            const next = pendingMetricsRef.current;
            pendingMetricsRef.current = undefined;
            if (next !== undefined) flushMetrics(next);
          }, Math.max(16, 160 - elapsed));
        }
      },
    };
  }, [basePath]);

  const assetUrls = useMemo(() => {
    if (!frame?.snapshot?.assets?.length || !basePath) return {};
    const act = frame.activation !== undefined ? `?activation=${encodeURIComponent(String(frame.activation))}` : '';
    return Object.fromEntries(
      frame.snapshot.assets.map(asset => [asset.id, `${basePath}/assets/${encodeURIComponent(asset.id)}${act}`]),
    );
  }, [frame, basePath]);

  if (frame?.snapshot) {
    const activeSnapshotId = frame.snapshot.id;
    return (
      <WindChimeLiveCard
        key={`${frame.epoch ?? 'obs'}:${frame.activation ?? frame.snapshot.id}`}
        snapshot={frame.snapshot}
        appearance={frame.appearance ?? DEFAULT_WINDCHIME_LIVE_APPEARANCE}
        assetUrls={assetUrls}
        scrollControl={scrollControl}
        localOverlay={overlay}
        spotlightAssetId={spotlightAssetId}
        enhancedMotion={displayMotion}
        onAssetError={() => {
          if (currentSnapshotIdRef.current === activeSnapshotId) {
            currentSnapshotIdRef.current = null;
            setSpotlightAssetId(null);
            setFrame(null);
          }
        }}
      />
    );
  }
  if (testCard.active) {
    const hasCustomFill = Boolean(
      testCard.appearance &&
      testCard.appearance.transparent === false &&
      typeof testCard.appearance.backgroundColor === 'string' &&
      testCard.appearance.backgroundColor.trim(),
    );
    const testAppearance: WindChimeLiveAppearance = {
      ...DEFAULT_WINDCHIME_LIVE_APPEARANCE,
      ...(testCard.appearance ?? {}),
      transparent: false,
      backgroundColor: hasCustomFill
        ? testCard.appearance!.backgroundColor
        : 'rgba(16, 28, 42, 0.88)',
      textColor: hasCustomFill
        ? (testCard.appearance?.textColor || DEFAULT_WINDCHIME_LIVE_APPEARANCE.textColor)
        : '#eef8fc',
    };
    return (
      <>
        <WindChimeLiveCard
          key="obs-local-test-card"
          snapshot={buildObsTestCard(viewport.width, viewport.height)}
          appearance={testAppearance}
          assetUrls={{}}
          localOverlay={overlay}
          enhancedMotion={displayMotion}
        />
        <div className="wc-test-guide" aria-hidden="true">
          <i className="tl" /><i className="tr" /><i className="bl" /><i className="br" />
        </div>
        <div className="wc-test-size" aria-hidden="true">{`${viewport.width} × ${viewport.height} px`}</div>
      </>
    );
  }
  return null;
}

createRoot(document.getElementById('root')!).render(<ObsOutput />);
