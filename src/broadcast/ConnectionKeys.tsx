'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createWindChimeLiveClient, type WindChimeLiveClient } from '../client/live.js';
import { encodeWindChimeConnectionKey } from '../core/connection-key.js';
import type { WindChimeLiveGrant } from '../core/live.js';

export type WindChimeConnectionKeysProps = {
  /** Existing website admin session; a desktop/display token cannot create site keys. */
  client?: WindChimeLiveClient;
  topicId: string;
  topicTitle?: string;
  userCode?: string;
  className?: string;
  onUnauthorized?: () => void;
};

const defaultClient = createWindChimeLiveClient();
const clientIds = new WeakMap<WindChimeLiveClient, number>();
let nextClientId = 0;
const stack: CSSProperties = { display: 'grid', gap: 14 };
const input: CSSProperties = { width: '100%', border: '1px solid currentColor', borderRadius: 10, background: 'transparent', padding: '10px 12px', color: 'inherit', font: 'inherit' };
const button: CSSProperties = { border: '1px solid currentColor', borderRadius: 10, padding: '9px 14px', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' };

/** Private website key management, independent of the live review/control UI. */
export function WindChimeConnectionKeys(props: WindChimeConnectionKeysProps) {
  const client = props.client ?? defaultClient;
  if (!clientIds.has(client)) clientIds.set(client, ++nextClientId);
  return <ConnectionKeysOwner key={`${clientIds.get(client)}:${props.topicId}:${props.userCode || ''}`} {...props} />;
}

function ConnectionKeysOwner({ client = defaultClient, topicId, topicTitle, userCode = '', className, onUnauthorized }: WindChimeConnectionKeysProps) {
  const [label, setLabel] = useState('');
  const [code, setCode] = useState(userCode);
  const [grants, setGrants] = useState<WindChimeLiveGrant[]>([]);
  const [created, setCreated] = useState<{ id: string; value: string; label: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lifecycle = useRef(0);
  const loads = useRef(0);
  const mutation = useRef<symbol | null>(null);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;
  const report = useCallback((cause: unknown) => {
    if (cause && typeof cause === 'object' && 'status' in cause && cause.status === 401) unauthorized.current?.();
    setError(cause instanceof Error ? cause.message : '操作失败，请重试');
  }, []);
  const reload = useCallback(async () => {
    const version = lifecycle.current;
    const request = ++loads.current;
    try {
      const result = await client.grants();
      if (version === lifecycle.current && request === loads.current) {
        setGrants(result.items);
        setCreated(current => current && result.items.some(grant => grant.id === current.id && !grant.revokedAt && Date.parse(grant.expiresAt) > Date.now()) ? current : null);
      }
    } catch (cause) { if (version === lifecycle.current && request === loads.current) report(cause); }
  }, [client, report]);

  useEffect(() => {
    lifecycle.current += 1;
    void reload();
    const refresh = () => { if (document.visibilityState === 'visible' && !mutation.current) void reload(); };
    const timer = setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      lifecycle.current += 1;
      loads.current += 1;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [topicId, userCode, reload]);

  async function run(operation: () => Promise<void>, success: string) {
    if (mutation.current) return;
    const operationId = Symbol();
    mutation.current = operationId;
    loads.current += 1;
    const version = lifecycle.current;
    setBusy(true); setError(''); setNotice('');
    try {
      await operation();
      if (version === lifecycle.current) { setNotice(success); await reload(); }
    } catch (cause) { if (version === lifecycle.current) report(cause); }
    finally { if (mutation.current === operationId) mutation.current = null; if (version === lifecycle.current) setBusy(false); }
  }
  async function create() {
    const version = lifecycle.current;
    const name = label.trim();
    if (!name) throw new Error('请填写密钥名称');
    const capabilities = await client.capabilities();
    if (version !== lifecycle.current) return;
    if (!capabilities.features.connectionKeys || !capabilities.features.siteControl) throw new Error('网站版本不支持全站连接密钥，请先升级网站至 0.7.0');
    const grant = await client.createSiteGrant(name);
    if (version !== lifecycle.current) return;
    const value = encodeWindChimeConnectionKey({ origin: window.location.origin, siteId: capabilities.siteId, token: grant.token });
    setCreated({ id: grant.id, value, label: name, expiresAt: grant.expiresAt });
  }

  return <section className={className} aria-label="桌面连接密钥" style={stack}>
    <div><h2 style={{ fontSize: 20, fontWeight: 700 }}>桌面连接密钥</h2><p style={{ marginTop: 8, opacity: .8 }}>生成后复制到风铃桌面版 0.7.0 或更高版本。密钥可管理本站全部话题，有效期 30 天，可供多台电脑使用；重复连接不会延长有效期。</p></div>
    <label style={stack}>密钥名称<input style={input} value={label} maxLength={100} autoComplete="off" placeholder="例如：直播电脑" onChange={event => setLabel(event.target.value)} /></label>
    <div><button type="button" style={button} disabled={busy || !label.trim()} onClick={() => void run(create, '连接密钥已生成，只在本次页面显示')}>{busy ? '处理中…' : '生成连接密钥'}</button></div>
    {created ? <div style={stack}><strong>{created.label} · 全站管理</strong><span>到期时间：{new Date(created.expiresAt).toLocaleString('zh-CN')}</span><textarea style={input} aria-label="完整连接密钥" readOnly rows={4} autoComplete="off" spellCheck={false} value={created.value} /><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" style={button} disabled={busy} onClick={() => void run(() => navigator.clipboard.writeText(created.value), '连接密钥已复制')}>复制连接密钥</button><button type="button" style={button} onClick={() => setCreated(null)}>隐藏密钥</button></div><p style={{ opacity: .8 }}>完整密钥只显示一次，不会保存在浏览器中。刷新、切换话题或退出登录后不再显示；隐藏文本不会撤销授权。</p></div> : null}
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    <details><summary style={{ cursor: 'pointer' }}>已生成的授权（{grants.length}）</summary><div style={{ ...stack, marginTop: 14 }}><div><button type="button" style={button} disabled={busy} onClick={() => void run(async () => {}, '授权列表已刷新')}>刷新授权列表</button></div>{grants.map(grant => <div key={grant.id} style={{ ...stack, borderTop: '1px solid currentColor', paddingTop: 12 }}><strong>{grant.label || (grant.kind === 'display' ? '只读展示' : '旧版设备')}</strong><span>{grant.scope === 'site' ? '全站管理' : `${grant.kind === 'display' ? '只读展示' : '话题管理'} · ${grant.topicId}`} · 到期 {new Date(grant.expiresAt).toLocaleString('zh-CN')} · {grant.revokedAt ? '已撤销' : Date.parse(grant.expiresAt) <= Date.now() ? '已到期' : '有效'}</span>{!grant.revokedAt ? <div><button type="button" style={button} disabled={busy} aria-label={`撤销授权 ${grant.label || grant.id}`} onClick={() => {
      if (window.confirm('撤销后，使用此密钥的所有电脑及其展示授权会失效。确认撤销？')) void run(async () => { await client.revokeGrant(undefined, grant.id); setCreated(current => current?.id === grant.id ? null : current); }, '授权已撤销');
    }}>撤销</button></div> : null}</div>)}</div></details>
    <details open={Boolean(userCode)}><summary style={{ cursor: 'pointer' }}>旧版设备配对</summary><div style={{ ...stack, marginTop: 14 }}><p>仅授权当前话题：{topicTitle || topicId}。旧版配对不会取得全站管理权限。</p><label style={stack}>配对码<input style={input} value={code} maxLength={32} autoComplete="off" onChange={event => setCode(event.target.value)} /></label><div><button type="button" style={button} disabled={busy || !code.trim()} onClick={() => void run(async () => { await client.approveDevice(code.trim(), topicId); }, '已批准设备连接当前话题')}>批准设备配对</button></div></div></details>
  </section>;
}
