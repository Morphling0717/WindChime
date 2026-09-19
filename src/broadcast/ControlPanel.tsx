'use client';
import { useEffect, useRef, useState } from 'react';
import type { WindChimeLiveClient } from '../client/live.js';
import { encodeWindChimeConnectionKey } from '../core/connection-key.js';
import type { WindChimeLiveDraft, WindChimeLiveGrant, WindChimeLiveMessage, WindChimeLiveSnapshot } from '../core/live.js';
import { useWindChimeLiveControl } from '../react/live.js';
import { WindChimeLiveCard } from './Display.js';
import { windChimeControlCss } from './styles.js';
import { AppearanceEditor } from './AppearanceEditor.js';

const statusLabels = { pending: '未审核', approved: '已批准', rejected: '已拒绝' };
type Studio = ReturnType<typeof useWindChimeLiveControl>;
type PrivateAsset = { url: string; mimeType: string; width: number; height: number };
function usePrivateAssets(client: WindChimeLiveClient, topicId: string, ids: string[]) {
  const [loaded, setLoaded] = useState<{ client: WindChimeLiveClient; topicId: string; signature: string; assets: Record<string, PrivateAsset> } | null>(null);
  const signature = ids.join('|');
  useEffect(() => {
    let cancelled = false; const controller = new AbortController(); const owned = new Set<string>();
    const release = () => { cancelled = true; controller.abort(); owned.forEach(url => URL.revokeObjectURL(url)); owned.clear(); };
    setLoaded(null);
    void Promise.all(ids.map(async id => {
      const blob = await client.asset(topicId, id, controller.signal);
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 5 * 1024 * 1024) throw new Error('图片格式无效');
      if (cancelled || controller.signal.aborted) throw new Error('已取消图片加载');
      const decoded = await createImageBitmap(blob);
      try {
        if (cancelled || controller.signal.aborted) throw new Error('已取消图片加载');
        if (!(decoded.width > 0 && decoded.height > 0)) throw new Error('图片尺寸无效');
        const url = URL.createObjectURL(blob); owned.add(url);
        return [id, { url, mimeType: blob.type, width: decoded.width, height: decoded.height }] as const;
      } finally { decoded.close(); }
    })).then(entries => { if (!cancelled) setLoaded({ client, topicId, signature, assets: Object.fromEntries(entries) }); }).catch(release);
    return release;
    // IDs define the requested bytes; their order is significant only for presentation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, topicId, signature]);
  return loaded?.client === client && loaded.topicId === topicId && loaded.signature === signature ? loaded.assets : {};
}
function ReviewEditor({ message, studio, client, topicId, onDirtyChange, blockedTermsEnabled }: { message: WindChimeLiveMessage; studio: Studio; client: WindChimeLiveClient; topicId: string; onDirtyChange: (dirty: boolean) => void; blockedTermsEnabled: boolean }) {
  const [{ draft, basis }, setEditor] = useState(() => ({ draft: structuredClone(message.draft), basis: { draft: structuredClone(message.draft), revision: message.draftRevision } }));
  const setDraft = (value: WindChimeLiveDraft | ((before: WindChimeLiveDraft) => WindChimeLiveDraft)) => setEditor(before => ({ ...before, draft: typeof value === 'function' ? value(before.draft) : value }));
  const setBasis = (value: { draft: WindChimeLiveDraft; revision: number }) => setEditor(before => ({ ...before, basis: value }));
  const [markError, setMarkError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null); const replaceIndex = useRef<number | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(basis.draft);
  useEffect(() => { onDirtyChange(dirty || uploading); }, [dirty, uploading, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const conflict = basis.revision !== message.draftRevision;
  const privateAssets = usePrivateAssets(client, topicId, [...new Set([...message.source.assets, ...draft.assets].map(a => a.id))]);
  const urls = Object.fromEntries(Object.entries(privateAssets).map(([id, asset]) => [id, asset.url]));
  const snapshot: WindChimeLiveSnapshot = { ...draft, id: message.snapshotId ?? `preview-${message.id}`, messageId: message.id, assets: draft.assets.flatMap(a => {
    const asset = privateAssets[a.id];
    return asset ? [{ ...a, mimeType: asset.mimeType, width: asset.width, height: asset.height, sha256: '' }] : [];
  }) };
  const act = async (action: 'approve' | 'reject' | 'revoke' | 'draft') => {
    const submittedDraft = structuredClone(draft), submittedRevision = basis.revision;
    const result = await studio.actWithResult({ action, messageId: message.id, expectedDraftRevision: submittedRevision, ...(action === 'draft' ? { draft: submittedDraft } : {}) });
    if (result && action === 'draft') {
      const saved = result.messages.find(item => item.id === message.id);
      if (saved?.draftRevision === submittedRevision + 1) setEditor(before => {
        if (before.basis.revision !== submittedRevision) return before;
        return {
          // Normalize our saved input, but never overwrite edits typed while it was saving.
          draft: JSON.stringify(before.draft) === JSON.stringify(submittedDraft) ? structuredClone(saved.draft) : before.draft,
          basis: { draft: structuredClone(saved.draft), revision: saved.draftRevision },
        };
      });
    }
    return !!result;
  };
  const mark = async (patch: { isRead?: boolean; isFavorited?: boolean }) => { setMarkError(''); try { await client.message(topicId, message.id, patch); } catch (e) { setMarkError(e instanceof Error ? e.message : '标记失败'); } };
  const upload = async (file: File) => {
    const replace = replaceIndex.current; setUploading(true); setMarkError('');
    try {
      const asset = await client.upload(topicId, message.id, file);
      setDraft(before => { const assets = [...before.assets]; if (replace !== null) assets[replace] = { id: asset.id, caption: assets[replace]?.caption ?? '' }; else if (assets.length < 3) assets.push({ id: asset.id, caption: '' }); return { ...before, assets }; });
    } catch (e) { setMarkError(e instanceof Error ? e.message : '图片上传失败'); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const reorderAsset = (from: number, to: number) => setDraft(before => { const assets = [...before.assets]; assets.splice(to, 0, assets.splice(from, 1)[0]!); return { ...before, assets }; });
  return <div className="wc-stack wc-pad">
    <div className="wc-actions"><span className={`wc-tag ${message.status}`}>{statusLabels[message.status]}</span><span className="wc-muted">当前审阅版本 {basis.revision}</span>{blockedTermsEnabled && message.isFlagged ? <span className="wc-tag rejected">敏感词标记</span> : null}</div>
    {conflict ? <div className="wc-error" role="alert"><strong>展示稿已在其他控制端更新为版本 {message.draftRevision}。</strong><p>你的本地改稿仍保留；确认新版本后才能保存或批准。</p><details><summary>查看服务器的最新展示稿</summary><div className="wc-source">{message.draft.nickname}<br />{message.draft.text}{message.draft.linkUrl ? <p>{message.draft.linkUrl}</p> : null}{message.draft.assets.map((asset, index) => <p key={asset.id}>图片 {index + 1}：{asset.caption || '无说明'}</p>)}</div></details><div className="wc-actions"><button onClick={() => { setDraft(structuredClone(message.draft)); setBasis({ draft: structuredClone(message.draft), revision: message.draftRevision }); }}>载入最新版本，放弃本地改动</button>{dirty ? <button onClick={() => setBasis({ draft: structuredClone(message.draft), revision: message.draftRevision })}>确认新版本，保留我的编辑</button> : null}</div></div> : null}
    <div className="wc-actions"><button disabled={!studio.connected} onClick={() => void mark({ isRead: !message.isRead })}>{message.isRead ? '标为未读' : '标为已读'}</button><button disabled={!studio.connected} aria-pressed={message.isFavorited} onClick={() => void mark({ isFavorited: !message.isFavorited })}>{message.isFavorited ? '♥ 已收藏' : '♡ 收藏'}</button></div>{markError ? <p className="wc-error" role="alert">{markError}</p> : null}
    <div><div className="wc-muted" style={{ marginBottom: 6 }}>投稿原文 · 仅主播可见</div><div className="wc-source">
      {message.source.nickname ? <strong>{message.source.nickname}<br /></strong> : null}{message.source.text}
      {message.source.linkUrl ? <p style={{ marginTop: 10 }}>附带链接：{message.source.linkUrl}</p> : null}
      {message.source.assets.map(a => <figure key={a.id} style={{ margin: '12px 0 0' }}>{urls[a.id] ? <img src={urls[a.id]} alt={a.caption || '投稿原始附件'} style={{ maxWidth: '100%', maxHeight: 200 }} /> : <span>附件载入中或不可用</span>}{a.caption ? <figcaption>{a.caption}</figcaption> : null}</figure>)}
    </div></div>
    <div className="wc-rule" /><div><h3>最终展示稿</h3><p className="wc-muted">批准覆盖下面的称呼、正文、链接文字与图片说明。外链只显示文字。</p></div>
    <label>展示称呼<input value={draft.nickname ?? ''} maxLength={32} onChange={e => setDraft({ ...draft, nickname: e.target.value || null })} /></label>
    <label>展示正文<textarea value={draft.text} maxLength={1000} rows={7} onChange={e => setDraft({ ...draft, text: e.target.value })} /></label>
    <label>展示链接文字<input value={draft.linkUrl ?? ''} maxLength={500} onChange={e => setDraft({ ...draft, linkUrl: e.target.value || null })} /></label>
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传审核图片" style={{ display: 'none' }} onChange={e => { const file = e.currentTarget.files?.[0]; if (file) void upload(file); }} />
    {draft.assets.map((a, index) => <div key={a.id} className="wc-stack"><div className="wc-asset">{urls[a.id] ? <img src={urls[a.id]} alt="将上屏的已保存图片" /> : <span className="wc-muted">图片载入中</span>}<label>图片 {index + 1} 说明<input value={a.caption} maxLength={200} onChange={e => setDraft({ ...draft, assets: draft.assets.map((item, at) => at === index ? { ...item, caption: e.target.value } : item) })} /></label></div><div className="wc-actions"><button disabled={uploading} onClick={() => { replaceIndex.current = index; fileInput.current?.click(); }}>替换图片</button><button disabled={uploading} aria-label={`移除图片 ${index + 1}`} onClick={() => setDraft({ ...draft, assets: draft.assets.filter((_, at) => at !== index) })}>移除</button><button disabled={uploading || index === 0} aria-label={`上移图片 ${index + 1}`} onClick={() => reorderAsset(index, index - 1)}>↑</button><button disabled={uploading || index === draft.assets.length - 1} aria-label={`下移图片 ${index + 1}`} onClick={() => reorderAsset(index, index + 1)}>↓</button></div></div>)}
    <button disabled={uploading || draft.assets.length >= 3 || !studio.connected} onClick={() => { replaceIndex.current = null; fileInput.current?.click(); }}>{uploading ? '正在保存审核图片…' : '添加展示图片（最多 3 张）'}</button>
    {message.source.assets.some(a => !draft.assets.some(d => d.id === a.id)) ? <button className="wc-subtle" onClick={() => setDraft({ ...draft, assets: structuredClone(message.source.assets) })}>恢复投稿附件</button> : null}
    <div className="wc-actions"><button disabled={!dirty || conflict || uploading || studio.pending || !studio.connected || !draft.text.trim()} onClick={() => void act('draft')}>保存展示稿</button><span className="wc-muted">{dirty ? '有未保存改动；保存后需重新批准' : '展示稿已保存'}</span></div>
    <details open><summary>私下预览 · 不会上屏</summary><div className="wc-preview"><WindChimeLiveCard snapshot={snapshot} appearance={studio.state!.appearance} assetUrls={urls} /></div></details>
    <div className="wc-actions"><button className="wc-primary" disabled={dirty || conflict || uploading || studio.pending || !studio.connected || message.status === 'approved' || draft.assets.some(a => !urls[a.id])} onClick={() => void act('approve')}>批准进入待播</button><button disabled={studio.pending || message.status === 'rejected'} onClick={() => void act('reject')}>拒绝</button>{message.status === 'approved' ? <button className="wc-danger" onClick={() => void act('revoke')}>撤销批准并撤下</button> : null}</div>
    <p className="wc-muted">批准后仍需在待播列表点击「上屏」。已读、收藏{blockedTermsEnabled ? '和敏感词标记' : ''}与播出批准相互独立。</p>
  </div>;
}
type ConnectionsProps = Pick<WindChimeLiveControlPanelProps, 'client' | 'topicId' | 'displayUrl' | 'onOpenDisplay' | 'onCopyDisplayLink' | 'onBindGateway' | 'deviceCode' | 'canApproveDevices' | 'enablePlatformIntegration'>;
function Connections(props: ConnectionsProps) {
  const [owner, setOwner] = useState({ client: props.client, topicId: props.topicId, generation: 0 });
  // Reset during render, before a different client can commit the previous credential.
  if (owner.client !== props.client || owner.topicId !== props.topicId) {
    setOwner({ client: props.client, topicId: props.topicId, generation: owner.generation + 1 });
    return null;
  }
  return <ConnectionControls key={`${owner.generation}:${props.canApproveDevices !== false}`} {...props} />;
}
function ConnectionControls({ client, topicId, displayUrl, onOpenDisplay, onCopyDisplayLink, onBindGateway, deviceCode, canApproveDevices = true, enablePlatformIntegration = false }: ConnectionsProps) {
  const [grants, setGrants] = useState<WindChimeLiveGrant[]>([]);
  const [url, setUrl] = useState(''); const [code, setCode] = useState(deviceCode ?? '');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState(''); const [challenge, setChallenge] = useState('');
  const [label, setLabel] = useState('');
  const [connectionKey, setConnectionKey] = useState<{ value: string; grantId: string; label: string; expiresAt: string } | null>(null);
  const alive = useRef(true); const running = useRef(false); const refreshSequence = useRef(0);
  const canCreateDisplayLink = Boolean(displayUrl || onCopyDisplayLink);
  async function refresh() {
    const sequence = ++refreshSequence.current;
    const result = await client.grants(topicId);
    if (!alive.current || sequence !== refreshSequence.current) return;
    const items = result.items.filter(grant => grant.topicId === topicId);
    setGrants(items);
    setConnectionKey(current => current && items.some(grant => grant.id === current.grantId && !grant.revokedAt && Date.parse(grant.expiresAt) > Date.now()) ? current : null);
  }
  useEffect(() => {
    alive.current = true; void refresh().catch(() => {});
    return () => { alive.current = false; };
    // Connections remounts this component when its client, topic or authority changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setCode(deviceCode ?? ''); }, [deviceCode]);
  const run = async (operation: () => Promise<unknown>, message = '') => {
    if (!alive.current || running.current) return;
    running.current = true; ++refreshSequence.current; setBusy(true); setError(''); setNotice('');
    try { await operation(); if (!alive.current) return; if (message) setNotice(message); await refresh(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '操作失败'); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  const createConnectionKey = async () => {
    const name = label.trim();
    if (!canApproveDevices || !name) throw new Error('请先填写连接名称');
    setConnectionKey(null);
    const origin = window.location.origin;
    const capabilities = await client.capabilities();
    if (!alive.current) return;
    if (capabilities.protocolVersion !== 1 || !capabilities.features.connectionKeys || !capabilities.siteId) throw new Error('本站尚不支持连接密钥，请先升级风铃');
    const grant = await client.createGrant(topicId, 'control', name);
    if (!alive.current) return;
    if (grant.topicId !== topicId || grant.kind !== 'control') throw new Error('授权返回的信箱不一致，请刷新授权列表后重试');
    const value = encodeWindChimeConnectionKey({ origin, siteId: capabilities.siteId, token: grant.token });
    setConnectionKey({ value, grantId: grant.id, label: name, expiresAt: grant.expiresAt });
  };
  const copyConnectionKey = async () => {
    if (!canApproveDevices || !connectionKey) return;
    try { await navigator.clipboard.writeText(connectionKey.value); }
    catch { throw new Error('未能复制，请手动选中并复制当前连接密钥'); }
  };
  const revoke = async (id: string) => {
    await client.revokeGrant(topicId, id);
    if (alive.current) setConnectionKey(current => current?.grantId === id ? null : current);
  };
  const createLink = async () => {
    if (onCopyDisplayLink) { await onCopyDisplayLink(); if (alive.current) setNotice('展示链接已复制；只读授权由桌面主进程保管。'); return; }
    if (!displayUrl) throw new Error('宿主尚未配置独立展示地址');
    const grant = await client.createGrant(topicId, 'display', '直播展示页');
    if (!alive.current) return;
    const target = new URL(displayUrl, window.location.origin);
    target.hash = new URLSearchParams({ siteBaseUrl: `${window.location.origin}/api/mail/live`, token: grant.token }).toString(); setUrl(target.href);
  };
  return <div className="wc-stack"><div className="wc-actions">{onOpenDisplay ? <button disabled={busy} onClick={() => void run(onOpenDisplay)}>打开独立展示窗口</button> : null}{canCreateDisplayLink ? <button disabled={busy} onClick={() => void run(createLink)}>生成只读展示链接</button> : null}</div>
    {canCreateDisplayLink && url ? <div className="wc-stack"><p className="wc-grant-url">{url}</p><button onClick={() => void run(() => navigator.clipboard.writeText(url), '展示链接已复制')}>复制展示链接</button><p className="wc-muted">此链接可读取当前播出内容，请只粘贴到直播软件的浏览器源。</p></div> : null}
    {canApproveDevices ? <><div className="wc-rule" /><h3>桌面连接密钥</h3><p className="wc-muted">当前话题：{topicId}。填写名称后生成密钥，复制到桌面端即可连接。默认有效期 30 天，可在多台电脑重复使用；撤销此授权会让共用密钥的所有电脑断开。</p><label>连接名称<input value={label} maxLength={100} autoComplete="off" placeholder="例如：家里的直播电脑" onChange={e => setLabel(e.target.value)} /></label><button disabled={busy || !label.trim()} onClick={() => void run(createConnectionKey)}>生成桌面连接密钥</button>
      {connectionKey ? <div className="wc-stack"><p>{connectionKey.label} · 话题：{topicId} · 到期 {new Date(connectionKey.expiresAt).toLocaleString('zh-CN')}</p><textarea readOnly rows={4} autoComplete="off" spellCheck={false} aria-label="桌面连接密钥" value={connectionKey.value} /><button disabled={busy} onClick={() => void run(copyConnectionKey, '连接密钥已复制')}>复制连接密钥</button><button className="wc-subtle" onClick={() => setConnectionKey(null)}>隐藏本页密钥</button><p className="wc-muted">此密钥允许查看原文和管理当前话题，请妥善保管。只在本页显示，刷新或关闭后不再显示；隐藏文本不会撤销授权。</p></div> : null}
      <details open={Boolean(deviceCode)}><summary>旧版设备配对</summary><div className="wc-stack"><label>桌面设备配对码<input value={code} placeholder="在桌面端发起连接后填写" maxLength={32} onChange={e => setCode(e.target.value)} /></label><button disabled={busy || !code.trim()} onClick={() => void run(() => client.approveDevice(code.trim(), topicId), '已批准该设备控制当前信箱')}>批准此设备连接当前信箱</button></div></details></> : null}
    {enablePlatformIntegration ? <details><summary>连接 B 站启动网关</summary><div className="wc-stack"><p className="wc-muted">需要部署平台接入网关，并在网站配置其公钥。平台密钥由网关保管。</p>{onBindGateway ? <button disabled={busy} onClick={() => void run(onBindGateway)}>连接 B 站会话</button> : null}<button disabled={busy} onClick={() => void run(async () => setChallenge(JSON.stringify(await client.bindingChallenge(topicId))))}>生成绑定挑战</button>{challenge ? <textarea readOnly aria-label="绑定挑战" value={challenge} /> : null}<label>网关签名绑定凭证<textarea rows={3} value={proof} onChange={e => setProof(e.target.value)} /></label><button disabled={busy || !proof} onClick={() => void run(() => client.bind(topicId, proof), '信箱与平台会话已绑定')}>确认绑定</button><button disabled={busy} onClick={() => void run(() => client.unbind(topicId), '平台绑定已解除，相关展示授权已撤销')}>解除平台绑定</button></div></details> : null}
    <details><summary>管理授权（{grants.filter(g => !g.revokedAt && Date.parse(g.expiresAt) > Date.now()).length}）</summary><div className="wc-stack"><button disabled={busy} onClick={() => void run(async () => {}, '授权列表已刷新')}>刷新授权列表</button>{grants.map(g => <div key={g.id} className="wc-actions"><span className="wc-muted" style={{ flex: 1 }}>{g.label || (g.kind === 'display' ? '展示端' : '控制设备')} · {g.kind === 'display' ? '只读展示' : '控制授权'} · 话题：{g.topicId} · 到期 {new Date(g.expiresAt).toLocaleString('zh-CN')} · {g.revokedAt ? '已撤销' : Date.parse(g.expiresAt) <= Date.now() ? '已到期' : '有效'}</span>{!g.revokedAt ? <button disabled={busy} aria-label={`撤销授权 ${g.label || g.id}`} onClick={() => void run(() => revoke(g.id), '授权已撤销，使用此授权的所有电脑将断开')}>撤销</button> : null}</div>)}</div></details>
    {error ? <p className="wc-error" role="alert">{error}</p> : null}{notice ? <p className="wc-notice" role="status">{notice}</p> : null}
  </div>;
}
export const WINDCHIME_LIVE_MODULES = [
  { id: 'inbox', title: '来信列表' },
  { id: 'review', title: '审阅与预览' },
  { id: 'queue', title: '待播顺序' },
  { id: 'transport', title: '快捷播控' },
  { id: 'appearance', title: '展示外观' },
] as const;
export type WindChimeLiveModule = typeof WINDCHIME_LIVE_MODULES[number]['id'];
export type WindChimeLiveControlPanelProps = {
  client: WindChimeLiveClient; topicId: string; title?: string; displayUrl?: string; deviceCode?: string; canApproveDevices?: boolean; enablePlatformIntegration?: boolean;
  onOpenDisplay?: () => Promise<void>; onCopyDisplayLink?: () => Promise<void>; onBindGateway?: () => Promise<void>;
  /** Desktop hosts can clear the native output even before the first state read completes. */
  onHideDisplay?: () => Promise<void>;
  blockedTermsEnabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onConfirmDiscard?: () => Promise<boolean>;
  /** Render one private module without mounting the other editors or authorization UI. */
  module?: WindChimeLiveModule;
  onOpenTile?: (module: WindChimeLiveModule) => Promise<void>;
  /** Hosts can synchronize review selection across private windows. The host must confirm dirty editors. */
  selectedMessageId?: string | null;
  onSelectMessage?: (id: string) => Promise<void>;
};
/** Private control surface. Hosts can reuse the hook/client for wholly custom UIs. */
export function WindChimeLiveControlPanel(props: WindChimeLiveControlPanelProps) {
  const { client, topicId, title = '风铃直播信箱' } = props;
  const studio = useWindChimeLiveControl(client, topicId);
  const [localSelection, setSelection] = useState(''); const [filter, setFilter] = useState('all'); const [dragging, setDragging] = useState('');
  const selection = props.selectedMessageId === undefined ? localSelection : props.selectedMessageId ?? '';
  const includes = (module: WindChimeLiveModule) => props.module === undefined || props.module === module;
  const [auxiliaryError, setAuxiliaryError] = useState('');
  const [reviewDirty, setReviewDirty] = useState(false);
  const [appearanceDirty, setAppearanceDirty] = useState(false);
  useEffect(() => { props.onDirtyChange?.(reviewDirty || appearanceDirty); }, [reviewDirty, appearanceDirty, props.onDirtyChange]);
  useEffect(() => () => props.onDirtyChange?.(false), [props.onDirtyChange]);
  const select = async (id: string) => {
    if (selection === id) return;
    if (props.onSelectMessage) {
      setAuxiliaryError('');
      try { await props.onSelectMessage(id); } catch (error) { setAuxiliaryError(error instanceof Error ? error.message : '无法切换来信'); }
      return;
    }
    if (reviewDirty && !(await (props.onConfirmDiscard?.() ?? Promise.resolve(typeof window !== 'undefined' && window.confirm('展示稿尚未保存。放弃改动并切换信件？'))))) return;
    setSelection(id);
  };
  const state = studio.state;
  const selected = state?.messages.find(m => m.id === selection);
  const visible = state?.messages.filter(m => filter === 'all' || m.status === filter) ?? [];
  const queue = state?.queue.map(id => state.messages.find(m => m.id === id)).filter((m): m is WindChimeLiveMessage => !!m) ?? [];
  const shift = (from: number, to: number) => { if (!state || to < 0 || to >= state.queue.length || from === to) return; const order = [...state.queue]; order.splice(to, 0, order.splice(from, 1)[0]!); void studio.act({ action: 'reorder', order }); };
  const openTile = (module: WindChimeLiveModule) => {
    setAuxiliaryError('');
    void props.onOpenTile?.(module).catch(error => setAuxiliaryError(error instanceof Error ? error.message : '无法打开磁贴'));
  };
  const hideDisplay = () => {
    setAuxiliaryError('');
    if (props.onHideDisplay) void props.onHideDisplay().catch(error => setAuxiliaryError(error instanceof Error ? error.message : '隐藏失败'));
    else void studio.act({ action: 'hide' });
  };
  return <section className="wc-live" data-module={props.module} aria-label="风铃私人审核控制台"><style>{windChimeControlCss}</style>
    {props.module ? null : <header className="wc-top"><div><div className="wc-eyebrow">WINDCHIME / PRIVATE STUDIO</div><h2>{title}</h2><p className="wc-muted">先审阅，再安排，每一封由你决定。</p></div><div className="wc-actions"><button onClick={() => void studio.act({ action: 'end' })}>结束展示</button><button className="wc-danger" style={{ fontSize: 17, padding: '12px 22px' }} onClick={hideDisplay}>■ 一键隐藏</button></div></header>}
    <div className="wc-status" role="status"><span><i className={`wc-led${studio.connected ? ' on' : ''}`} />{studio.connected ? '控制已连接' : '连接状态未确认'}</span><span>{state?.receivers ?? 0} 个展示端就绪</span><strong style={{ marginLeft: 'auto', fontSize: 12 }}>{state?.current ? '正在展示已批准信件' : '观众画面为空白'}</strong></div>
    {studio.error || auxiliaryError ? <div className="wc-error" role="alert">{studio.error || auxiliaryError}</div> : null}
    {props.onOpenTile && !props.module ? <nav className="wc-tile-launcher" aria-label="悬浮磁贴"><strong>悬浮磁贴</strong><span className="wc-muted">将常用模块固定在手边</span><div className="wc-actions">{WINDCHIME_LIVE_MODULES.map(item => <button key={item.id} aria-label={`打开${item.title}磁贴`} onClick={() => openTile(item.id)}>{item.title} ↗</button>)}</div></nav> : null}
    {props.module === 'transport' ? <section className="wc-panel wc-transport-panel"><div className="wc-pad wc-transport-actions">
      <button className="wc-primary" disabled={!studio.connected || !state?.receivers || studio.pending} onClick={() => void studio.act({ action: 'next' })}>下一封 →</button>
      <button className="wc-danger" onClick={hideDisplay}>■ 一键隐藏</button><button onClick={() => void studio.act({ action: 'end' })}>结束展示</button>
      {props.onOpenDisplay ? <button onClick={() => { setAuxiliaryError(''); void props.onOpenDisplay!().catch(error => setAuxiliaryError(error instanceof Error ? error.message : '无法打开展示窗口')); }}>打开独立展示窗口</button> : null}
      <p className="wc-muted">{queue.length} 封已批准 · 列表末尾自动清空</p>
    </div></section> : null}
    {includes('inbox') || includes('review') || includes('queue') ? <div className="wc-columns">
      {includes('inbox') ? <section className="wc-panel"><div className="wc-panel-head"><h3>来信审核</h3><span className="wc-muted">{state?.messages.length ?? 0} 封</span></div><div className="wc-tabs" aria-label="审核状态">{[['all', '全部'], ['pending', '未审核'], ['approved', '已批准'], ['rejected', '已拒绝']].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div><div className="wc-mail-list">{visible.map(m => <button key={m.id} className="wc-mail" aria-current={selection === m.id} onClick={() => void select(m.id)}><div className="wc-mail-title"><strong>{m.draft.nickname || '匿名来信'}</strong><span className={`wc-tag ${m.status}`}>{statusLabels[m.status]}</span></div><div className="wc-snippet">{m.source.text}</div><div className="wc-muted" style={{ marginTop: 8, fontSize: 10 }}>{new Date(m.createdAt).toLocaleString('zh-CN')}</div></button>)}{!visible.length ? <p className="wc-empty">{state ? '此分类暂无来信' : '正在连接信箱…'}</p> : null}</div></section> : null}
      {includes('review') ? <section className="wc-panel"><div className="wc-panel-head"><h3>审阅与预览</h3><span className="wc-muted">此区域仅主播可见</span></div>{selected ? <ReviewEditor key={`${topicId}:${selected.id}`} message={selected} studio={studio} client={client} topicId={topicId} onDirtyChange={setReviewDirty} blockedTermsEnabled={props.blockedTermsEnabled === true} /> : <p className="wc-empty">{props.module ? '在来信磁贴或主工作台选择一封来信。' : '选择左侧一封来信，审阅最终展示内容。'}</p>}</section> : null}
      {includes('queue') ? <aside className="wc-panel wc-queue-panel"><div className="wc-panel-head"><h3>待播顺序</h3><span className="wc-muted">{queue.length} 封已批准</span></div><div className="wc-pad wc-stack"><p className="wc-muted">拖动或使用箭头排序。已播放信件保留在列表中，可随时重新上屏。</p><button className="wc-primary" disabled={!studio.connected || !state?.receivers || studio.pending} onClick={() => void studio.act({ action: 'next' })}>下一封 →</button>{props.onOpenDisplay ? <button onClick={() => { setAuxiliaryError(''); void props.onOpenDisplay!().catch(error => setAuxiliaryError(error instanceof Error ? error.message : '无法打开展示窗口')); }}>打开独立展示窗口</button> : null}</div><ol className="wc-queue">{queue.map((m, index) => <li key={m.id} draggable={!studio.pending} onDragStart={() => setDragging(m.id)} onDragOver={e => e.preventDefault()} onDrop={() => { shift(state!.queue.indexOf(dragging), index); setDragging(''); }} aria-current={state?.current?.messageId === m.id}><div className="wc-mail-title"><strong>{index + 1}. {m.draft.nickname || '匿名来信'}</strong>{state?.current?.messageId === m.id ? <span className="wc-tag approved">正在播出</span> : null}</div><p className="wc-snippet">{m.draft.text}</p><div className="wc-actions" style={{ marginTop: 10 }}><button className="wc-primary wc-queue-small" disabled={studio.pending || !studio.connected || !state?.receivers} onClick={() => void studio.act({ action: 'show', messageId: m.id })}>上屏</button><button className="wc-queue-small" onClick={() => void select(m.id)}>审阅</button><button className="wc-queue-small" disabled={studio.pending || index === 0} aria-label={`上移第 ${index + 1} 封`} onClick={() => shift(index, index - 1)}>↑</button><button className="wc-queue-small" disabled={studio.pending || index === queue.length - 1} aria-label={`下移第 ${index + 1} 封`} onClick={() => shift(index, index + 1)}>↓</button><button className="wc-queue-small" onClick={() => void studio.act({ action: 'revoke', messageId: m.id })}>撤销批准</button></div></li>)}</ol>{!queue.length ? <p className="wc-empty">批准后的信件会出现在这里，等待你点击上屏。</p> : null}</aside> : null}
    </div> : null}
    {!props.module || includes('appearance') ? <div className="wc-grid2 wc-settings">
      {includes('appearance') ? <section className="wc-panel"><div className="wc-panel-head"><h3>展示外观</h3></div><div className="wc-pad">{state ? <AppearanceEditor key={topicId} studio={studio} onDirtyChange={setAppearanceDirty} /> : null}</div></section> : null}
      {!props.module ? <section className="wc-panel"><div className="wc-panel-head"><h3>展示授权与设备连接</h3></div><div className="wc-pad"><Connections key={topicId} {...props} /></div></section> : null}
    </div> : null}
  </section>;
}
