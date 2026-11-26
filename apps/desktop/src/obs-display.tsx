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

const LOCAL_TEST_CARD: WindChimeLiveSnapshot = {
  id: 'windchime-local-test-card',
  messageId: 'windchime-local-test-card',
  nickname: '对位测试卡 · OBS 浏览器源',
  text: 'OBS 浏览器源已连接成功！请将此浏览器源的宽高设为风铃推荐尺寸，并拖动到直播画面理想位置。\n\n确认位置无误后，在风铃控制台点击「关闭测试卡」即可恢复透明空白待机；本测试卡不会写入网站或任何来信。',
  linkUrl: null,
  assets: [],
};

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
  const scrollListeners = useRef(new Set<(cmd: WindChimeDisplayScrollCommand) => void>());
  const lastReportRef = useRef(0);

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
            setTestCard({ active: false, appearance: null });
            setFrame(payload);
          }
        } catch {}
      });
      source.addEventListener('blank', () => {
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
      source.addEventListener('scroll', ev => {
        try {
          const cmd = JSON.parse((ev as MessageEvent).data) as WindChimeDisplayScrollCommand;
          for (const handler of scrollListeners.current) handler(cmd);
        } catch {}
      });
      source.onerror = () => {
        // Fail closed immediately whenever the local bridge drops or resets.
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

  const scrollControl = useMemo(
    () => ({
      subscribe: (handler: (cmd: WindChimeDisplayScrollCommand) => void) => {
        scrollListeners.current.add(handler);
        return () => { scrollListeners.current.delete(handler); };
      },
      onMetrics: (metrics: WindChimeDisplayScrollMetrics | null) => {
        if (!basePath) return;
        const now = Date.now();
        if (metrics && now - lastReportRef.current < 160) return;
        lastReportRef.current = now;
        void fetch(`${basePath}/scroll-metrics`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(metrics),
          keepalive: true,
        }).catch(() => {});
      },
    }),
    [basePath],
  );

  const assetUrls = useMemo(() => {
    if (!frame?.snapshot?.assets?.length || !basePath) return {};
    const act = frame.activation !== undefined ? `?activation=${encodeURIComponent(String(frame.activation))}` : '';
    return Object.fromEntries(
      frame.snapshot.assets.map(asset => [asset.id, `${basePath}/assets/${encodeURIComponent(asset.id)}${act}`]),
    );
  }, [frame, basePath]);

  if (frame?.snapshot) {
    return (
      <WindChimeLiveCard
        key={`${frame.epoch ?? 'obs'}:${frame.activation ?? frame.snapshot.id}`}
        snapshot={frame.snapshot}
        appearance={frame.appearance ?? DEFAULT_WINDCHIME_LIVE_APPEARANCE}
        assetUrls={assetUrls}
        scrollControl={scrollControl}
        localOverlay={overlay}
      />
    );
  }
  if (testCard.active) {
    return (
      <WindChimeLiveCard
        key="obs-local-test-card"
        snapshot={LOCAL_TEST_CARD}
        appearance={testCard.appearance ?? DEFAULT_WINDCHIME_LIVE_APPEARANCE}
        assetUrls={{}}
        localOverlay={overlay}
      />
    );
  }
  return null;
}

createRoot(document.getElementById('root')!).render(<ObsOutput />);
