import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWindChimeLiveClient } from '../../../src/client/live';
import { createWindChimeClient } from '../../../src/client';
import { WindChimeLiveControlPanel, WINDCHIME_LIVE_MODULES, type WindChimeLiveModule } from '../../../src/broadcast/ControlPanel';
import type {
  WindChimeDisplayScrollCommand,
  WindChimeDisplayScrollMetrics,
} from '../../../src/broadcast/scroll-loop';
import {
  assetTransport,
  managementFetch,
  shortcutLabel,
  transport,
  unwrap,
  type DesktopOverlayState,
  type DesktopPrefs,
  type DesktopStatus,
  type DesktopTheme,
  type ObsBridgeStatus,
  type Site,
} from './bridge';
import './tiles.css';

const bridge = window.windchimeDesktop;

/** This private renderer receives no credential. The main process binds the native window to its topic. */
export function TileApp({ module }: { module: WindChimeLiveModule }) {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [keywordEnabled, setKeywordEnabled] = useState(false);
  const [topicTitle, setTopicTitle] = useState('');
  const [scrollState, setScrollState] = useState<WindChimeDisplayScrollMetrics | null>(null);
  const [theme, setTheme] = useState<DesktopTheme>('light');
  const [prefs, setPrefs] = useState<DesktopPrefs>({
    randomDrawEnabled: false,
    clearOnBlindDraw: false,
    chimeEnabled: false,
    chimeVolume: 70,
    startupView: 'last',
    lastView: null,
    autoCheckUpdate: true,
  });
  const [testCardActive, setTestCardActive] = useState(false);
  const [obsStatus, setObsStatus] = useState<ObsBridgeStatus | null>(null);
  const [overlay, setOverlay] = useState<DesktopOverlayState | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    void unwrap(bridge.getTheme()).then(value => { if (alive.current) setTheme(value); }).catch(() => {});
    return bridge.onThemeChanged(value => { if (alive.current) setTheme(value); });
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggleTheme = () => {
    const next: DesktopTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    void unwrap(bridge.setTheme(next)).catch(() => {});
  };
  useEffect(() => {
    if (module !== 'transport' && module !== 'blindbox') return;
    void unwrap(bridge.getScrollState()).then(value => { if (alive.current) setScrollState(value); }).catch(() => {});
    return bridge.onScrollState(value => { if (alive.current) setScrollState(value); });
  }, [module]);
  useEffect(() => {
    if (module !== 'blindbox') return;
    void unwrap(bridge.getPrefs()).then(value => { if (alive.current) setPrefs(value); }).catch(() => {});
    const offPrefs = bridge.onPrefsChanged(value => { if (alive.current) setPrefs(value); });
    void unwrap(bridge.getTestCard()).then(value => { if (alive.current) setTestCardActive(value); }).catch(() => {});
    const offTest = bridge.onTestCardChanged(value => { if (alive.current) setTestCardActive(value); });
    void unwrap(bridge.getObsStatus()).then(value => { if (alive.current) setObsStatus(value); }).catch(() => {});
    const offObs = bridge.onObsStatusChanged(value => { if (alive.current) setObsStatus(value); });
    return () => { offPrefs(); offTest(); offObs(); };
  }, [module]);
  useEffect(() => {
    if (module !== 'appearance') return;
    void unwrap(bridge.getOverlay()).then(value => { if (alive.current) setOverlay(value); }).catch(() => {});
    return bridge.onOverlayChanged(value => { if (alive.current) setOverlay(value); });
  }, [module]);

  const scrollDisplay = useCallback(
    (command: WindChimeDisplayScrollCommand) => unwrap(bridge.scrollDisplay(command)),
    [],
  );
  const updatePrefs = useCallback(async (patch: Partial<DesktopPrefs>) => {
    setPrefs(current => ({ ...current, ...patch }));
    const saved = await unwrap(bridge.setPrefs(patch));
    if (alive.current) setPrefs(saved);
  }, []);
  const toggleTestCard = useCallback(async (active: boolean) => {
    const next = await unwrap(bridge.setTestCard(active));
    if (alive.current) setTestCardActive(next);
  }, []);
  const refresh = useCallback(async () => {
    const current = await unwrap(bridge.status());
    if (alive.current) setStatus(current);
  }, []);
  useEffect(() => {
    alive.current = true;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try { await refresh(); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '磁贴连接已结束'); }
      finally { pending = false; }
    };
    void unwrap(bridge.sites()).then(result => { if (alive.current) setSite(result.items.find(item => item.id === result.selectedId) ?? null); }).catch(() => {});
    void poll();
    const timer = setInterval(() => void poll(), 500);
    window.addEventListener('focus', poll);
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener('focus', poll); };
  }, [refresh]);
  const tile = status?.tile;
  const client = useMemo(() => createWindChimeLiveClient({
    transport: transport({ request: input => bridge.request({ ...input, connectionId: tile?.connectionId }) }),
    assetTransport: assetTransport({ request: input => bridge.request({ ...input, connectionId: tile?.connectionId }) }),
    uploadTransport: async (_topicId, messageId, file) => unwrap(bridge.upload({ messageId, fileName: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()), connectionId: tile?.connectionId })),
  }), [tile?.connectionId, tile?.topicId, tile?.contextVersion]);
  const mailClient = useMemo(
    () => createWindChimeClient({ baseUrl: '/control', fetch: managementFetch(tile?.connectionId ?? '') }),
    [tile?.connectionId],
  );
  useEffect(() => {
    if (!tile) return;
    let disposed = false;
    let pending = false;
    const refreshKeywords = async () => {
      if (pending) return;
      pending = true;
      try {
        const topic = await unwrap(bridge.request({ path: `/control/topics/${encodeURIComponent(tile.topicId)}?view=admin`, method: 'GET', connectionId: tile.connectionId })) as { title: string };
        if (!disposed) setTopicTitle(topic.title);
        if (module === 'review' || module === 'blindbox') {
          const result = await unwrap(bridge.request({ path: `/control/messages?topicId=${encodeURIComponent(tile.topicId)}`, method: 'GET', connectionId: tile.connectionId })) as { blockedTermsEnabled?: boolean };
          if (!disposed) setKeywordEnabled(result.blockedTermsEnabled === true);
        }
      } catch { /* The live hook reports authorization and connectivity errors. */ }
      finally { pending = false; }
    };
    void refreshKeywords();
    const timer = setInterval(() => void refreshKeywords(), 3000);
    return () => { disposed = true; clearInterval(timer); };
  }, [tile?.connectionId, tile?.topicId, module]);
  const dirtyChanged = useCallback((dirty: boolean) => { void unwrap(bridge.setTileDirty(dirty)).catch(() => {}); }, []);
  const perform = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await operation(); await refresh(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '操作失败'); }
    finally { if (alive.current) setBusy(false); }
  };
  const title = WINDCHIME_LIVE_MODULES.find(item => item.id === module)!.title;
  return <div className="wc-desktop wc-tile" data-tile={module} data-theme={theme}>
    <header className="tile-titlebar">
      <div className="tile-title"><small>风铃 · 私人磁贴</small><strong>{title}</strong></div>
      <div className="tile-window-actions">
        <button type="button" className="tile-theme-btn" aria-label={theme === 'dark' ? '切换浅色外观' : '切换深色外观'} title={theme === 'dark' ? '切换浅色外观' : '切换深色外观'} onClick={toggleTheme}>{theme === 'dark' ? '☀' : '☾'}</button>
        <button disabled={busy || !tile} aria-label={tile?.pinned ? '取消置顶' : '固定在最上方'} aria-pressed={tile?.pinned === true} onClick={() => void perform(() => unwrap(bridge.setTilePinned(module, !tile?.pinned)))}>{tile?.pinned ? '已置顶' : '置顶'}</button>
        <button className="tile-close" aria-label="关闭磁贴" disabled={busy} onClick={() => void perform(() => unwrap(bridge.closeTile(module)))}>×</button>
      </div>
    </header>
    <div className="tile-context"><span>{site?.label || '当前网站'}</span><span title={tile?.topicId}>{topicTitle || '正在连接话题…'}</span></div>
    <main className="tile-body">
      {error || status?.nextActionError ? <p className="tile-error" role="alert">{error || status?.nextActionError}</p> : null}
      {tile && tile.module === module ? <WindChimeLiveControlPanel key={`${tile.connectionId}:${tile.topicId}:${tile.contextVersion}`} module={module} client={client} topicId={tile.topicId}
        selectedMessageId={status.selectedMessageId} onSelectMessage={async id => { await unwrap(bridge.selectMessage(id, tile.connectionId, tile.contextVersion)); await refresh(); }}
        onDirtyChange={dirtyChanged} onConfirmDiscard={() => unwrap(bridge.confirm('有尚未保存的修改，放弃修改并继续？'))}
        onOpenDisplay={() => unwrap(bridge.openDisplay())} onHideDisplay={() => unwrap(bridge.hide())} canApproveDevices={false} blockedTermsEnabled={keywordEnabled}
        scrollState={module === 'transport' || module === 'blindbox' ? scrollState : undefined}
        onScrollDisplay={module === 'transport' || module === 'blindbox' ? scrollDisplay : undefined}
        testCardActive={module === 'blindbox' ? testCardActive : undefined}
        onToggleTestCard={module === 'blindbox' ? toggleTestCard : undefined}
        obsClientCount={module === 'blindbox' ? obsStatus?.clientCount ?? status.obsClients ?? 0 : undefined}
        randomDrawEnabled={module === 'blindbox' ? prefs.randomDrawEnabled : undefined}
        clearOnBlindDraw={module === 'blindbox' ? prefs.clearOnBlindDraw : undefined}
        onToggleClearOnBlindDraw={module === 'blindbox' ? enabled => void updatePrefs({ clearOnBlindDraw: enabled }).catch(() => {}) : undefined}
        onBlockMessage={
          module === 'blindbox' && site?.scope === 'site'
            ? async messageId => {
                if (!(await unwrap(bridge.confirm('在整个网站屏蔽此发送者并处理其来信？对应展示会同步撤下。')))) {
                  throw new Error('已取消屏蔽操作');
                }
                await mailClient.messages.block(messageId, { topicId: tile.topicId });
              }
            : undefined
        }
        localOverlay={module === 'appearance' ? overlay : undefined}
      /> : <p className="tile-wait">正在确认网站与话题…</p>}
    </main>
    <footer className="tile-footer"><span>私人操作 · 采集请选 WindChime Display / OBS 浏览器源</span>{module === 'transport' || module === 'blindbox' ? <span>隐藏：{status?.shortcut || 'Ctrl+Shift+H'} · 下一封：{shortcutLabel(status?.nextShortcut || '') || '未设置'}</span> : null}</footer>
  </div>;
}
