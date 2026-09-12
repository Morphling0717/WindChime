import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createWindChimeLiveClient } from '../../../src/client/live';
import { WindChimeLiveControlPanel } from '../../../src/broadcast/ControlPanel';
import { windChimeControlCss } from '../../../src/broadcast/styles';
import { assetTransport, transport, unwrap, type Site } from './bridge';
import { parseWindChimeConnectionKey } from '../../../src/core/connection-key';
const bridge = window.windchimeDesktop;
function App() {
  const [sites, setSites] = useState<Site[]>([]); const [selectedId, setSelectedId] = useState<string | null>(null);
  const [origin, setOrigin] = useState(''); const [label, setLabel] = useState(''); const [pairing, setPairing] = useState<{ id: string; userCode: string; expiresAt: string } | null>(null);
  const [connectionKey, setConnectionKey] = useState('');
  const keyOrigin = useMemo(() => { try { return parseWindChimeConnectionKey(connectionKey).origin; } catch { return ''; } }, [connectionKey]);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ connectionError: '', displayOpen: false, shortcut: 'Ctrl+Shift+H' });
  const selected = sites.find(site => site.id === selectedId);
  const refresh = useCallback(async () => { const result = await unwrap(bridge.sites()); setSites(result.items); setSelectedId(result.selectedId); }, []);
  const act = async (operation: () => Promise<unknown>, success = '') => { setBusy(true); setError(''); setNotice(''); try { await operation(); await refresh(); if (success) setNotice(success); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); } };
  useEffect(() => { void refresh().catch(e => setError(e.message)); const interval = setInterval(() => { void unwrap(bridge.status()).then(setStatus).catch(() => {}); }, 1000); return () => clearInterval(interval); }, [refresh]);
  useEffect(() => {
    if (!pairing) return;
    let disposed = false; let polling = false;
    const interval = setInterval(async () => {
      if (polling) return; polling = true;
      try {
        const result = await unwrap(bridge.pairingStatus(pairing.id));
        if (!disposed && result.status === 'approved') { setPairing(null); await refresh(); setNotice('信箱已连接。先打开展示窗口，批准来信后再手动上屏。'); }
        if (!disposed && result.status === 'expired') { setPairing(null); setError('配对已过期，请重新连接'); }
      } catch (e) { if (!disposed) { setPairing(null); setError(e instanceof Error ? e.message : '配对失败'); } }
      finally { polling = false; }
    }, 2000);
    return () => { disposed = true; clearInterval(interval); };
  }, [pairing, refresh]);
  const client = useMemo(() => createWindChimeLiveClient({ transport: transport(bridge), assetTransport: assetTransport(bridge), uploadTransport: async (_topicId, messageId, file) => unwrap(bridge.upload({ messageId, fileName: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })) }), [selectedId]);
  return <main style={{ maxWidth: 1800, margin: '0 auto', padding: 20 }}><style>{windChimeControlCss}</style>
    <section className="wc-live" style={{ minHeight: 0, marginBottom: 16 }}><div className="wc-top" style={{ marginBottom: 12 }}><div><div className="wc-eyebrow">WINDCHIME DESKTOP</div><h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}><img src="icon.png" width={48} height={48} alt="" />风铃桌面控制台</h2><p className="wc-muted">直播采集「WindChime Display」窗口。此窗口用于私下审核。</p></div><button className="wc-danger" onClick={() => void act(() => unwrap(bridge.hide()))}>■ 一键隐藏 · {status.shortcut}</button></div>
    {error ? <p className="wc-error" role="alert">{error}</p> : null}{status.connectionError ? <p className="wc-error" role="alert">{status.connectionError}</p> : null}{notice ? <p className="wc-notice" role="status">{notice}</p> : null}
    <div className="wc-actions" style={{ marginTop: 12 }}><label style={{ flex: 1 }}>当前信箱<select value={selectedId ?? ''} disabled={busy} onChange={e => void act(() => unwrap(bridge.selectSite(e.target.value)))}><option value="" disabled>请连接一个网站信箱</option>{sites.map(site => <option key={site.id} value={site.id}>{site.label} · {site.topicId}</option>)}</select></label>{selected ? <button disabled={busy} onClick={() => void act(() => unwrap(bridge.forgetSite(selected.id)), '已从此电脑移除连接；可在网站管理设备授权')}>移除此连接</button> : null}</div>
    {selected ? <p className="wc-muted" style={{ marginTop: 8 }}>{selected.origin} · 设备授权到期 {new Date(selected.expiresAt).toLocaleString('zh-CN')}</p> : null}
    <details open={!sites.length}><summary>连接其他网站与信箱</summary>
      <label>连接密钥<input type="password" autoComplete="off" spellCheck={false} value={connectionKey} maxLength={4096} onChange={e => setConnectionKey(e.target.value)} placeholder="粘贴网页后台生成的完整连接密钥" /></label>
      <p className="wc-muted">在网站私人后台选择话题并生成连接密钥。密钥有效期 30 天，多台电脑可共用；网页撤销后一起失效。</p>
      {keyOrigin ? <p className="wc-muted">将连接到：{keyOrigin}</p> : connectionKey.trim() ? <p className="wc-error" role="alert">密钥格式无效或版本不支持，请复制完整密钥。</p> : null}
      <button className="wc-primary" disabled={busy || !keyOrigin || !!pairing} onClick={() => {
        const submittedKey = connectionKey;
        void act(async () => {
          await unwrap(bridge.importKey(submittedKey));
          setConnectionKey(current => current === submittedKey ? '' : current);
        }, '信箱已连接。打开展示窗口后，仍需手动上屏。');
      }}>使用密钥连接</button>
      <details style={{ marginTop: 16 }}><summary>备用：旧版浏览器配对</summary><div className="wc-grid2"><label>网站地址<input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="https://uliuli.cn" /></label><label>连接名称<input value={label} onChange={e => setLabel(e.target.value)} placeholder="例如：UliUli · 常规信箱" maxLength={80} /></label></div><div className="wc-actions" style={{ marginTop: 12 }}><button className="wc-primary" disabled={busy || !origin || !!pairing} onClick={() => void act(async () => setPairing(await unwrap(bridge.pair({ origin, label }))))}>在浏览器中登录并授权</button></div>{pairing ? <div className="wc-notice" style={{ marginTop: 12 }}><strong>设备配对码：{pairing.userCode}</strong><p>请在已打开的网站后台选择信箱，确认配对码后批准设备。</p><button style={{ marginTop: 8 }} onClick={() => void act(async () => { await unwrap(bridge.cancelPairing(pairing.id)); setPairing(null); })}>取消配对</button></div> : null}</details>
    </details>
    </section>
    {selected ? <WindChimeLiveControlPanel key={selected.id} client={client} topicId={selected.topicId} title={selected.label} canApproveDevices={false} onOpenDisplay={() => unwrap(bridge.openDisplay())} /> : null}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
