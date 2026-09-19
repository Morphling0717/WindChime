import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWindChimeLiveClient } from '../../../src/client/live';
import { WindChimeLiveControlPanel, WINDCHIME_LIVE_MODULES, type WindChimeLiveModule } from '../../../src/broadcast/ControlPanel';
import { assetTransport, shortcutLabel, transport, unwrap, type DesktopStatus, type Site } from './bridge';
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
  const alive = useRef(true);
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
        if (module === 'review') {
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
  return <div className="wc-desktop wc-tile" data-tile={module}>
    <header className="tile-titlebar">
      <div className="tile-title"><small>风铃 · 私人磁贴</small><strong>{title}</strong></div>
      <div className="tile-window-actions">
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
      /> : <p className="tile-wait">正在确认网站与话题…</p>}
    </main>
    <footer className="tile-footer"><span>私人操作 · 采集请选 WindChime Display</span>{module === 'transport' ? <span>下一封：{shortcutLabel(status?.nextShortcut || '') || '未设置热键'}</span> : null}</footer>
  </div>;
}
