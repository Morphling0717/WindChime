import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createWindChimeDisplayClient } from '../../../src/client/live';
import { DEFAULT_WINDCHIME_LIVE_APPEARANCE, type WindChimeLiveAppearance, type WindChimeLiveSnapshot } from '../../../src/core/live';
import { WindChimeLiveDisplay, type WindChimeLocalOverlay } from '../../../src/broadcast/Display';
import { assetTransport, transport, unwrap } from './bridge';

const client = createWindChimeDisplayClient({
  transport: transport(window.windchimeOutput),
  assetTransport: assetTransport(window.windchimeOutput),
});

function buildNativeTestCard(width: number, height: number): WindChimeLiveSnapshot {
  return {
    id: 'windchime-local-test-card',
    messageId: 'windchime-local-test-card',
    nickname: `对位测试卡 · 独立展示窗（${width} × ${height}）`,
    text:
      '按住此测试卡任意位置可直接拖动窗口到副屏或理想区域；在风铃控制台「OBS / 直播姬采集设置」可一键切换竖屏 / 宽幅预设或自定义宽高拉长拉宽。\n\n' +
      '确认效果后点击「关闭测试卡」即恢复透明空白待机；本测试卡不会写入网站或任何来信。',
    linkUrl: null,
    assets: [],
  };
}

function Output() {
  const [generation, setGeneration] = useState(0);
  const [testCard, setTestCard] = useState<{ active: boolean; appearance: WindChimeLiveAppearance | null }>({ active: false, appearance: null });
  const [overlay, setOverlay] = useState<WindChimeLocalOverlay | null>(null);
  const [spotlightAssetId, setSpotlightAssetId] = useState<string | null>(null);
  const [displayMotion, setDisplayMotion] = useState(true);
  const [viewport, setViewport] = useState(() => ({ width: Math.round(window.innerWidth || 0), height: Math.round(window.innerHeight || 0) }));
  useEffect(() => {
    const syncSize = () => setViewport({ width: Math.round(window.innerWidth || 0), height: Math.round(window.innerHeight || 0) });
    syncSize();
    window.addEventListener('resize', syncSize);
    return () => window.removeEventListener('resize', syncSize);
  }, []);
  useEffect(() => {
    void unwrap(window.windchimeOutput.getOverlay()).then(setOverlay).catch(() => {});
    return window.windchimeOutput.onOverlay(setOverlay);
  }, []);
  useEffect(() => {
    void unwrap(window.windchimeOutput.getMotion()).then(setDisplayMotion).catch(() => {});
    return window.windchimeOutput.onMotion(setDisplayMotion);
  }, []);
  useEffect(() => {
    void unwrap(window.windchimeOutput.getSpotlight()).then(setSpotlightAssetId).catch(() => {});
    return window.windchimeOutput.onSpotlight(setSpotlightAssetId);
  }, []);
  useEffect(() => window.windchimeOutput.onBlank(() => { setSpotlightAssetId(null); setTestCard({ active: false, appearance: null }); setGeneration(value => value + 1); }), []);
  useEffect(() => {
    void unwrap(window.windchimeOutput.getTestCard()).then(payload => {
      if (payload && typeof payload === 'object') {
        setTestCard({ active: Boolean(payload.active), appearance: (payload.appearance as WindChimeLiveAppearance | null) ?? null });
      }
    }).catch(() => {});
    return window.windchimeOutput.onTestCard(payload => setTestCard({ active: payload.active, appearance: (payload.appearance as WindChimeLiveAppearance | null) ?? null }));
  }, []);
  const scrollControl = useMemo(() => ({
    subscribe: (handler: Parameters<typeof window.windchimeOutput.onScrollCommand>[0]) =>
      window.windchimeOutput.onScrollCommand(handler),
    onMetrics: (metrics: Parameters<typeof window.windchimeOutput.reportScroll>[0]) =>
      window.windchimeOutput.reportScroll(metrics),
  }), []);
  const hasTestCardFill = Boolean(
    testCard.appearance &&
    testCard.appearance.transparent === false &&
    typeof testCard.appearance.backgroundColor === 'string' &&
    testCard.appearance.backgroundColor.trim(),
  );
  return (
    <>
      <WindChimeLiveDisplay
        key={generation}
        client={client}
        pollIntervalMs={500}
        scrollControl={scrollControl}
        fallbackSnapshot={testCard.active ? buildNativeTestCard(viewport.width, viewport.height) : null}
        fallbackAppearance={
          testCard.active
            ? {
                ...DEFAULT_WINDCHIME_LIVE_APPEARANCE,
                ...(testCard.appearance ?? {}),
                transparent: false,
                backgroundColor: hasTestCardFill
                  ? testCard.appearance!.backgroundColor
                  : 'rgba(16, 28, 42, 0.88)',
                textColor: hasTestCardFill
                  ? (testCard.appearance?.textColor || DEFAULT_WINDCHIME_LIVE_APPEARANCE.textColor)
                  : '#eef8fc',
              }
            : testCard.appearance
        }
        localOverlay={overlay}
        spotlightAssetId={spotlightAssetId}
        enhancedMotion={displayMotion}
      />
      {testCard.active ? (
        <>
          <div className="wc-test-drag" aria-hidden="true" />
          <div className="wc-test-guide" aria-hidden="true">
            <i className="tl" /><i className="tr" /><i className="bl" /><i className="br" />
          </div>
          <div className="wc-test-size" aria-hidden="true">{`${viewport.width} × ${viewport.height} px`}</div>
        </>
      ) : null}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Output />);
