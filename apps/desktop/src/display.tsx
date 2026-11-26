import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createWindChimeDisplayClient } from '../../../src/client/live';
import type { WindChimeLiveAppearance, WindChimeLiveSnapshot } from '../../../src/core/live';
import { WindChimeLiveDisplay, type WindChimeLocalOverlay } from '../../../src/broadcast/Display';
import { assetTransport, transport, unwrap } from './bridge';

const client = createWindChimeDisplayClient({
  transport: transport(window.windchimeOutput),
  assetTransport: assetTransport(window.windchimeOutput),
});

const LOCAL_TEST_CARD: WindChimeLiveSnapshot = {
  id: 'windchime-local-test-card',
  messageId: 'windchime-local-test-card',
  nickname: '对位测试卡 · 仅本机预览',
  text: '请在 OBS / 直播姬中添加「窗口捕获」并选择 WindChime Display，将画面位置、缩放比例和字号调整到理想状态。\n\n确认效果后，在私人控制台点击「关闭测试卡」即可恢复空白待机；本测试卡不会写入网站或任何来信。',
  linkUrl: null,
  assets: [],
};

function Output() {
  const [generation, setGeneration] = useState(0);
  const [testCard, setTestCard] = useState<{ active: boolean; appearance: WindChimeLiveAppearance | null }>({ active: false, appearance: null });
  const [overlay, setOverlay] = useState<WindChimeLocalOverlay | null>(null);
  useEffect(() => {
    void unwrap(window.windchimeOutput.getOverlay()).then(setOverlay).catch(() => {});
    return window.windchimeOutput.onOverlay(setOverlay);
  }, []);
  useEffect(() => window.windchimeOutput.onBlank(() => { setTestCard({ active: false, appearance: null }); setGeneration(value => value + 1); }), []);
  useEffect(() => window.windchimeOutput.onTestCard(payload => setTestCard({ active: payload.active, appearance: (payload.appearance as WindChimeLiveAppearance | null) ?? null })), []);
  const scrollControl = useMemo(() => ({
    subscribe: (handler: Parameters<typeof window.windchimeOutput.onScrollCommand>[0]) =>
      window.windchimeOutput.onScrollCommand(handler),
    onMetrics: (metrics: Parameters<typeof window.windchimeOutput.reportScroll>[0]) =>
      window.windchimeOutput.reportScroll(metrics),
  }), []);
  return (
    <WindChimeLiveDisplay
      key={generation}
      client={client}
      pollIntervalMs={500}
      scrollControl={scrollControl}
      fallbackSnapshot={testCard.active ? LOCAL_TEST_CARD : null}
      fallbackAppearance={testCard.appearance}
      localOverlay={overlay}
    />
  );
}
createRoot(document.getElementById('root')!).render(<Output />);
