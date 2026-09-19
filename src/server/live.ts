import { randomUUID, createHash } from "node:crypto";
import type { WindChimeSqlExecutor, WindChimeStorage } from "../sqlite/index.js";
import {
  DEFAULT_WINDCHIME_LIVE_APPEARANCE, type WindChimeLiveAction, type WindChimeLiveAppearance,
  type WindChimeLiveControlState, type WindChimeLiveDraft, type WindChimeLiveFrame,
  type WindChimeLiveMessage, type WindChimeLiveSnapshot,
} from "../core/live.js";
import { fail, objectInput, onlyFields, textInput, linkInput } from "./validation.js";
import { resolveTopic } from "./topics.js";
import { liveHash, liveSecret, liveAssetDto, type LiveAssetRow } from "./live-media.js";
import type { WindChimeConnectionIdentity } from "../core/connection-key.js";

const LEASE_MS = 3000;
const runtime = globalThis as typeof globalThis & { __windchimeLiveEpoch?: string };
const PROCESS_EPOCH = (runtime.__windchimeLiveEpoch ??= randomUUID());
type Channel = { topic_id: string; revision: number; activation: number; current_snapshot: string | null; last_shown: string | null; runtime_epoch: string | null; appearance: string };
type DraftRow = { message_id: string; topic_id: string; source_hash: string; draft_json: string; revision: number; status: "pending" | "approved" | "rejected"; snapshot_id: string | null };
type SourceRow = { id: string; topic_id: string; created_at: string; text: string; nickname: string | null; link_url: string | null; is_read: number; is_favorited: number; is_flagged: number };
export type LiveGrantRow = { id: string; token_hash: string; kind: "display" | "control"; scope: "site" | "topic"; topic_id: string | null; label: string; expires_at: number; revoked_at: number | null; binding_id: string | null; platform_session: string | null; parent_grant_id: string | null };
type Receiver = { id: string; grantId: string; topicId: string; joinedActivation: number; lastSeen: number; epoch: string };
export type LiveProof = { kind: "binding" | "display" | "lease"; iss: string; aud: string; siteId: string; topicId: string; bindingId: string; biliSubject: string; sessionId: string; jti: string; iat: number; exp: number; nonce?: string };
export type WindChimeBroadcastOptions = { storage: WindChimeStorage; ready: () => Promise<void>; now: () => number; runtimeEpoch?: string };
function appearance(value: unknown): WindChimeLiveAppearance {
  const raw = objectInput(value), result = { ...DEFAULT_WINDCHIME_LIVE_APPEARANCE };
  onlyFields(raw, Object.keys(result));
  if (raw.fontFamily !== undefined) {
    if (typeof raw.fontFamily !== "string" || !/^[\p{L}\p{N} ,_'"-]{1,120}$/u.test(raw.fontFamily)) fail("INVALID_APPEARANCE", "字体名称无效");
    result.fontFamily = raw.fontFamily;
  }
  for (const [key, min, max] of [
    ["fontSize", 12, 96], ["padding", 0, 100], ["borderRadius", 0, 100],
    ["borderWidth", 0, 8], ["lineHeight", 1.1, 2.4], ["letterSpacing", -1, 6], ["maxWidth", 280, 1920],
    ["viewportHeight", 180, 1080], ["scrollSpeed", 5, 120], ["scrollStartPauseMs", 0, 15000], ["scrollEndPauseMs", 0, 15000],
  ] as const) if (raw[key] !== undefined) {
    const n = raw[key]; if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) fail("INVALID_APPEARANCE", "外观数值超出范围"); result[key] = n;
  }
  for (const key of ["textColor", "backgroundColor", "accentColor"] as const) if (raw[key] !== undefined) {
    if (typeof raw[key] !== "string" || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw[key] as string)) fail("INVALID_APPEARANCE", "颜色必须是十六进制颜色"); result[key] = raw[key] as string;
  }
  if (raw.transparent !== undefined) { if (typeof raw.transparent !== "boolean") fail("INVALID_APPEARANCE", "透明值无效"); result.transparent = raw.transparent; }
  if (raw.autoScroll !== undefined) { if (typeof raw.autoScroll !== "boolean") fail("INVALID_APPEARANCE", "自动滚动值无效"); result.autoScroll = raw.autoScroll; }
  if (raw.layout !== undefined) { if (!["card", "letter", "minimal", "stack", "split", "banner"].includes(raw.layout as string)) fail("INVALID_APPEARANCE", "布局无效"); result.layout = raw.layout as WindChimeLiveAppearance["layout"]; }
  if (raw.theme !== undefined) { if (!["pure", "uliuli", "mia"].includes(raw.theme as string)) fail("INVALID_APPEARANCE", "主题无效"); result.theme = raw.theme as WindChimeLiveAppearance["theme"]; }
  if (raw.imageLayout !== undefined) { if (!["row", "column", "grid"].includes(raw.imageLayout as string)) fail("INVALID_APPEARANCE", "图片布局无效"); result.imageLayout = raw.imageLayout as WindChimeLiveAppearance["imageLayout"]; }
  if (raw.animation !== undefined) { if (!["none", "fade", "slide"].includes(raw.animation as string)) fail("INVALID_APPEARANCE", "动画无效"); result.animation = raw.animation as WindChimeLiveAppearance["animation"]; }
  return result;
}
function normalizeDraft(value: unknown): WindChimeLiveDraft {
  const raw = objectInput(value); onlyFields(raw, ["text", "nickname", "linkUrl", "assets"]);
  if (!Array.isArray(raw.assets) || raw.assets.length > 3) fail("INVALID_DRAFT", "图片列表无效");
  const assets = raw.assets.map((item) => { const a = objectInput(item); onlyFields(a, ["id", "caption"]); return { id: textInput(a.id, 100, "图片", true)!, caption: textInput(a.caption, 300, "图片说明") ?? "" }; });
  if (new Set(assets.map((a) => a.id)).size !== assets.length) fail("INVALID_DRAFT", "图片不能重复");
  return { text: textInput(raw.text, 10000, "正文", true)!, nickname: textInput(raw.nickname, 100, "昵称"), linkUrl: linkInput(raw.linkUrl, 2000), assets };
}
export function createWindChimeBroadcast(options: WindChimeBroadcastOptions) {
  const { storage, ready, now } = options, epoch = options.runtimeEpoch ?? PROCESS_EPOCH;
  const receivers = new Map<string, Receiver>();
  async function siteId() { await ready(); return (await storage.get<{site_id:string}>("SELECT site_id FROM mail_live_identity WHERE id=1"))!.site_id; }
  async function topic(db: WindChimeSqlExecutor, id: string) { return resolveTopic(db, id, now()); }
  async function channel(db: WindChimeSqlExecutor, id: string): Promise<Channel> {
    await db.run("INSERT OR IGNORE INTO mail_live_channels(topic_id) VALUES(?)", [id]);
    return (await db.get<Channel>("SELECT * FROM mail_live_channels WHERE topic_id=?", [id]))!;
  }
  function pruneReceivers() { for (const [id, r] of receivers) if (r.lastSeen + LEASE_MS <= now()) receivers.delete(id); }
  async function source(db: WindChimeSqlExecutor, message: SourceRow) {
    const assets = await db.all<LiveAssetRow>("SELECT * FROM mail_live_assets WHERE message_id=? AND purpose='source' ORDER BY ordinal,id", [message.id]);
    const draft: WindChimeLiveDraft = { text: message.text, nickname: message.nickname, linkUrl: message.link_url, assets: assets.map((a) => ({ id: a.id, caption: "" })) };
    const hash = liveHash(JSON.stringify({ ...draft, assets: assets.map((a) => [a.id, a.sha256, a.width, a.height, a.mime_type]) }));
    return { draft, hash, assets };
  }
  async function syncDraft(db: WindChimeSqlExecutor, row: SourceRow) {
    const s = await source(db, row);
    let d = await db.get<DraftRow>("SELECT * FROM mail_live_drafts WHERE message_id=?", [row.id]);
    if (!d) {
      await db.run("INSERT INTO mail_live_drafts(message_id,topic_id,source_hash,draft_json) VALUES(?,?,?,?)", [row.id, row.topic_id, s.hash, JSON.stringify(s.draft)]);
    } else if (d.source_hash !== s.hash || d.topic_id !== row.topic_id) {
      await db.run("UPDATE mail_live_drafts SET topic_id=?,source_hash=?,draft_json=?,revision=revision+1,status='pending',snapshot_id=NULL WHERE message_id=?", [row.topic_id, s.hash, JSON.stringify(s.draft), row.id]);
      await db.run("DELETE FROM mail_live_queue WHERE message_id=?", [row.id]);
      await db.run("UPDATE mail_live_channels SET revision=revision+1,activation=activation+1,current_snapshot=NULL WHERE topic_id IN(?,?)", [row.topic_id, d.topic_id]);
    }
    d = (await db.get<DraftRow>("SELECT * FROM mail_live_drafts WHERE message_id=?", [row.id]))!;
    return { d, s };
  }
  async function stateTx(db: WindChimeSqlExecutor, topicId: string): Promise<WindChimeLiveControlState> {
    const t = await topic(db, topicId); await channel(db, t.id);
    const rows = await db.all<SourceRow>("SELECT * FROM mail_messages WHERE topic_id=? AND deleted_at IS NULL ORDER BY created_at DESC,id DESC", [t.id]);
    const messages: WindChimeLiveMessage[] = [];
    for (const row of rows) {
      const { d, s } = await syncDraft(db, row);
      messages.push({ id: row.id, createdAt: row.created_at, isRead: !!row.is_read, isFavorited: !!row.is_favorited, isFlagged: !!row.is_flagged, source: s.draft, draft: JSON.parse(d.draft_json), draftRevision: d.revision, status: d.status, snapshotId: d.snapshot_id });
    }
    const c = await channel(db, t.id); pruneReceivers();
    const healthyGrants = new Set((await db.all<{id:string}>(`SELECT g.id FROM mail_live_grants g WHERE g.topic_id=? AND g.kind='display' AND g.revoked_at IS NULL AND g.expires_at>?
      AND (g.parent_grant_id IS NULL OR EXISTS(SELECT 1 FROM mail_live_grants p WHERE p.id=g.parent_grant_id AND p.revoked_at IS NULL AND p.expires_at>?))`, [t.id, now(), now()])).map((g) => g.id));
    const onlineReceivers = [...receivers.values()].filter((r) => r.topicId === t.id && r.epoch === epoch && healthyGrants.has(r.grantId));
    const currentSnapshot = c.runtime_epoch === epoch && !t.archivedAt && c.current_snapshot && onlineReceivers.some((r) => r.joinedActivation < c.activation)
      ? await db.get<{id:string;message_id:string}>("SELECT id,message_id FROM mail_live_snapshots WHERE id=?", [c.current_snapshot]) : null;
    const q = await db.all<{message_id:string}>("SELECT message_id FROM mail_live_queue WHERE topic_id=? ORDER BY position,message_id", [t.id]);
    return { topicId: t.id, revision: c.revision, epoch, messages, queue: q.map((r) => r.message_id), current: currentSnapshot ? { messageId: currentSnapshot.message_id, snapshotId: currentSnapshot.id } : null,
      appearance: appearance(JSON.parse(c.appearance)), receivers: onlineReceivers.length };
  }
  async function state(topicId: string) { await ready(); return storage.transaction((db) => stateTx(db, topicId)); }
  async function action(input: WindChimeLiveAction, actor = "host-admin") {
    const raw = objectInput(input); onlyFields(raw, ["topicId", "action", "messageId", "expectedRevision", "expectedDraftRevision", "operationId", "draft", "order", "appearance"]);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail("INVALID_REVISION", "需要控制台版本");
    if (typeof input.operationId !== "string" || input.operationId.length < 8 || input.operationId.length > 128) fail("INVALID_OPERATION", "需要唯一操作 ID");
    if (!["draft", "approve", "reject", "revoke", "show", "next", "hide", "end", "reorder", "appearance"].includes(input.action)) fail("INVALID_ACTION", "未知直播操作");
    await ready();
    return storage.transaction(async (db) => {
      const t = await topic(db, input.topicId); const before = await stateTx(db, t.id); const c = await channel(db, t.id);
      const inputHash = liveHash(JSON.stringify(input));
      const prior = await db.get<{input_hash:string}>("SELECT input_hash FROM mail_live_operations WHERE operation_id=? AND topic_id=?", [input.operationId, t.id]);
      if (prior) { if (prior.input_hash !== inputHash) fail("OPERATION_CONFLICT", "操作 ID 已被使用", 409); return before; }
      if (!["hide", "end", "revoke", "reject"].includes(input.action) && input.expectedRevision !== c.revision) fail("REVISION_CONFLICT", "其他控制端已更新，请刷新后重试", 409);
      if (t.archivedAt && !["hide", "end", "revoke", "reject"].includes(input.action)) fail("TOPIC_ARCHIVED", "已归档信箱不可上屏", 409);
      const selected = input.messageId ? before.messages.find((m) => m.id === input.messageId) : null;
      if (["draft", "approve", "reject", "revoke", "show"].includes(input.action) && !selected) fail("MESSAGE_NOT_FOUND", "信件不属于当前信箱", 404);
      let hide = false;
      if (input.action === "draft") {
        if (input.expectedDraftRevision !== selected!.draftRevision) fail("DRAFT_CONFLICT", "原文或草稿已变动，请重新预览", 409);
        const draft = normalizeDraft(input.draft);
        const known = new Set((await db.all<{id:string}>("SELECT id FROM mail_live_assets WHERE message_id=? AND topic_id=?",[selected!.id,t.id])).map((a) => a.id));
        if (draft.assets.some((a) => !known.has(a.id))) fail("INVALID_ASSET", "图片不属于当前信件", 403);
        await db.run("UPDATE mail_live_drafts SET draft_json=?,revision=revision+1,status='pending',snapshot_id=NULL WHERE message_id=?", [JSON.stringify(draft), selected!.id]);
        await db.run("DELETE FROM mail_live_queue WHERE message_id=?", [selected!.id]); hide = before.current?.messageId === selected!.id;
      } else if (input.action === "approve") {
        if (input.expectedDraftRevision !== selected!.draftRevision) fail("DRAFT_CONFLICT", "原文或草稿已变动，请重新预览", 409);
        const d = (await db.get<DraftRow>("SELECT * FROM mail_live_drafts WHERE message_id=?", [selected!.id]))!;
        const draft = normalizeDraft(JSON.parse(d.draft_json));
        const assets = [];
        for (const a of draft.assets) { const row = await db.get<LiveAssetRow>("SELECT * FROM mail_live_assets WHERE id=? AND message_id=? AND topic_id=?", [a.id, selected!.id, t.id]); if (!row) fail("INVALID_ASSET", "图片不可确认", 409); assets.push(liveAssetDto(row!, a.caption)); }
        const id = randomUUID(), snapshot: WindChimeLiveSnapshot = { ...draft, assets, id, messageId: selected!.id };
        await db.run("INSERT INTO mail_live_snapshots(id,message_id,topic_id,source_hash,draft_revision,payload_json,created_at) VALUES(?,?,?,?,?,?,?)", [id, selected!.id, t.id, d.source_hash, d.revision, JSON.stringify(snapshot), now()]);
        await db.run("UPDATE mail_live_drafts SET status='approved',snapshot_id=? WHERE message_id=?", [id, selected!.id]);
        await db.run("INSERT INTO mail_live_queue(message_id,topic_id,snapshot_id,position) VALUES(?,?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM mail_live_queue WHERE topic_id=?)) ON CONFLICT(message_id) DO UPDATE SET snapshot_id=excluded.snapshot_id", [selected!.id, t.id, id, t.id]);
        hide = before.current?.messageId === selected!.id;
      } else if (input.action === "reject" || input.action === "revoke") {
        await db.run("UPDATE mail_live_drafts SET status=?,snapshot_id=NULL WHERE message_id=?", [input.action === "reject" ? "rejected" : "pending", selected!.id]);
        await db.run("DELETE FROM mail_live_queue WHERE message_id=?", [selected!.id]); hide = before.current?.messageId === selected!.id;
      } else if (input.action === "show" || input.action === "next") {
        let id = selected?.id;
        if (input.action === "next") { const last = c.runtime_epoch === epoch ? c.last_shown : null; const index = last ? before.queue.indexOf(last) + 1 : 0; id = before.queue[index]; }
        if (!id) hide = true;
        else {
          const chosen = before.messages.find((m) => m.id === id);
          if (!chosen || chosen.status !== "approved" || !chosen.snapshotId || !before.queue.includes(id)) fail("NOT_APPROVED", "信件尚未批准上屏", 409);
          if (!before.receivers) fail("DISPLAY_NOT_READY", "请先连接展示窗口再点击上屏", 409);
          await db.run("UPDATE mail_live_channels SET current_snapshot=?,last_shown=?,runtime_epoch=?,activation=activation+1 WHERE topic_id=?", [chosen.snapshotId, id, epoch, t.id]);
        }
      } else if (input.action === "hide" || input.action === "end") {
        hide = true;
        if (input.action === "end") { await db.run("UPDATE mail_live_channels SET last_shown=NULL WHERE topic_id=?", [t.id]); }
      } else if (input.action === "reorder") {
        const order = input.order;
        if (!Array.isArray(order) || order.length !== before.queue.length || new Set(order).size !== order.length || order.some((id) => !before.queue.includes(id))) fail("INVALID_ORDER", "必须包含当前全部获准信件且不能重复", 409);
        for (const [position, id] of order.entries()) await db.run("UPDATE mail_live_queue SET position=? WHERE message_id=? AND topic_id=?", [position, id, t.id]);
      } else if (input.action === "appearance") {
        const merged = appearance({ ...before.appearance, ...objectInput(input.appearance) });
        await db.run("UPDATE mail_live_channels SET appearance=? WHERE topic_id=?", [JSON.stringify(merged), t.id]);
      }
      if (hide) await db.run("UPDATE mail_live_channels SET current_snapshot=NULL,activation=activation+1 WHERE topic_id=?", [t.id]);
      await db.run("UPDATE mail_live_channels SET revision=revision+1 WHERE topic_id=?", [t.id]);
      await db.run("INSERT INTO mail_live_operations(operation_id,topic_id,input_hash,created_at) VALUES(?,?,?,?)", [input.operationId, t.id, inputHash, now()]);
      await db.run("INSERT INTO mail_live_audit(topic_id,action,actor,message_id,created_at) VALUES(?,?,?,?,?)", [t.id, input.action, actor, input.messageId ?? null, now()]);
      return stateTx(db, t.id);
    });
  }
  async function createGrant(topicId: string | null, kind: "display" | "control", label = "", durationMs = 30 * 86400000, bindingId: string | null = null, sessionId: string | null = null, parentGrantId: string | null = null, scope: "topic" | "site" = "topic") {
    if (scope === "site" && (kind !== "control" || topicId !== null || parentGrantId || bindingId || sessionId)) fail("INVALID_SCOPE", "站点授权必须是独立控制授权");
    if (scope !== "site" && (scope !== "topic" || !topicId)) fail("INVALID_SCOPE", "话题授权需要明确话题");
    await ready();
    const id = randomUUID(), token = (kind === "display" ? "wc_disp_" : "wc_ctl_") + liveSecret(), expires = now() + durationMs;
    return storage.transaction(async (db) => {
      const resolved = scope === "site" ? null : (await topic(db,topicId!)).id;
      if (parentGrantId && (kind !== "display" || !(await db.get("SELECT id FROM mail_live_grants WHERE id=? AND kind='control' AND (scope='site' OR topic_id=?) AND revoked_at IS NULL AND expires_at>?", [parentGrantId,resolved,now()])))) fail("UNAUTHORIZED", "签发设备授权已失效", 401);
      await db.run("INSERT INTO mail_live_grants(id,token_hash,kind,scope,topic_id,label,expires_at,binding_id,platform_session,parent_grant_id) VALUES(?,?,?,?,?,?,?,?,?,?)", [id, liveHash(token), kind, scope, resolved, label.slice(0, 100), expires, bindingId, sessionId, parentGrantId]);
      return { id, token, kind, scope, topicId: resolved, expiresAt: new Date(expires).toISOString() };
    });
  }
  async function authenticate(token: string, kind: "display" | "control", scope?: string) {
    await ready();
    const grant = await storage.get<LiveGrantRow>("SELECT * FROM mail_live_grants WHERE token_hash=? AND kind=? AND revoked_at IS NULL AND expires_at>?", [liveHash(token), kind, now()]);
    if (!grant) fail("UNAUTHORIZED", "授权失效", 401);
    if (grant!.parent_grant_id && !(await storage.get("SELECT id FROM mail_live_grants WHERE id=? AND revoked_at IS NULL AND expires_at>?", [grant!.parent_grant_id,now()]))) fail("UNAUTHORIZED", "签发设备授权已失效", 401);
    if (grant!.scope === "site" && (kind !== "control" || grant!.topic_id !== null)) fail("UNAUTHORIZED", "授权失效", 401);
    if (scope !== undefined) { const t = await storage.transaction((db) => topic(db, scope)); if (grant!.scope !== "site" && t.id !== grant!.topic_id) fail("FORBIDDEN", "授权不属于当前信箱", 403); }
    if (grant!.scope !== "site" && !(await storage.get("SELECT id FROM mail_topics WHERE id=?", [grant!.topic_id]))) fail("UNAUTHORIZED", "授权失效", 401);
    return grant!;
  }
  async function listGrants(topicId: string | null) {
    await ready(); const id = topicId === null ? null : (await storage.transaction((db) => topic(db, topicId))).id;
    const rows = await storage.all<LiveGrantRow>("SELECT * FROM mail_live_grants"+(id === null ? "" : " WHERE topic_id=?")+" ORDER BY expires_at DESC", id === null ? [] : [id]);
    return rows.map((g) => ({ id: g.id, kind: g.kind, scope: g.scope, topicId: g.topic_id, label: g.label, expiresAt: new Date(g.expires_at).toISOString(), revokedAt: g.revoked_at ? new Date(g.revoked_at).toISOString() : null }));
  }
  async function controlIdentity(token: string): Promise<WindChimeConnectionIdentity> {
    if (typeof token !== "string" || !/^wc_ctl_[A-Za-z0-9_-]{43}$/.test(token)) fail("CONNECTION_KEY_INVALID", "连接密钥无效", 401);
    await ready();
    // Read the identity and authorization together; never resolve a caller-provided topic.
    const row = await storage.get<{
      id: string; scope: "site" | "topic"; topic_id: string | null; title: string | null; label: string; site_id: string;
      expires_at: number; revoked_at: number | null;
    }>(`SELECT g.id,g.scope,g.topic_id,t.title,g.label,i.site_id,g.expires_at,g.revoked_at
      FROM mail_live_grants g LEFT JOIN mail_topics t ON t.id=g.topic_id
      JOIN mail_live_identity i ON i.id=1 WHERE g.token_hash=? AND g.kind='control' AND (g.scope='site' OR t.id IS NOT NULL)`, [liveHash(token)]);
    if (!row) fail("CONNECTION_KEY_INVALID", "连接密钥无效", 401);
    if (row!.revoked_at !== null) fail("CONNECTION_KEY_REVOKED", "连接密钥已撤销，请在网站后台重新生成", 401);
    if (row!.expires_at <= now()) fail("CONNECTION_KEY_EXPIRED", "连接密钥已过期，请在网站后台重新生成", 401);
    return { scope: row!.scope, siteId: row!.site_id, topicId: row!.topic_id, topicTitle: row!.title, label: row!.label,
      expiresAt: new Date(row!.expires_at).toISOString(), grantId: row!.id };
  }
  async function revokeGrant(id: string, topicId: string | null) {
    await ready(); const resolved = topicId === null ? null : (await storage.transaction((db) => topic(db, topicId))).id;
    const result = await storage.run("UPDATE mail_live_grants SET revoked_at=? WHERE id=?"+(resolved === null ? "" : " AND topic_id=?"), resolved === null ? [now(),id] : [now(), id, resolved]);
    if (!result.changes) fail("GRANT_NOT_FOUND", "授权不存在", 404);
    const affected = new Set([id,...(await storage.all<{id:string}>("SELECT id FROM mail_live_grants WHERE parent_grant_id=?",[id])).map((r)=>r.id)]);
    for (const [key, r] of receivers) if (affected.has(r.grantId)) receivers.delete(key);
    return { ok: true as const };
  }
  async function open(grant: LiveGrantRow) {
    if (grant.kind !== "display" || grant.scope !== "topic" || !grant.topic_id) fail("UNAUTHORIZED", "需要话题展示授权", 401);
    await ready(); pruneReceivers();
    const c = await storage.transaction((db) => channel(db, grant.topic_id!));
    const id = liveSecret();
    // Bound resource use; new readers cannot invalidate another healthy receiver.
    if (receivers.size >= 1000 || [...receivers.values()].filter((r) => r.grantId === grant.id).length >= 10) fail("RECEIVER_LIMIT", "展示连接过多", 429);
    receivers.set(id, { id, grantId: grant.id, topicId: grant.topic_id!, joinedActivation: c.activation, lastSeen: now(), epoch });
    return { receiverId: id, epoch, leaseMs: LEASE_MS, pollIntervalMs: 1000 };
  }
  function requireReceiver(grant: LiveGrantRow, id: string) {
    pruneReceivers(); const r = receivers.get(id);
    if (!r || r.grantId !== grant.id || r.topicId !== grant.topic_id || r.epoch !== epoch) fail("RECEIVER_EXPIRED", "展示连接已失效，请重新连接并手动上屏", 409);
    return r!;
  }
  async function frame(grant: LiveGrantRow, receiverId: string, touch = true): Promise<WindChimeLiveFrame> {
    const r = requireReceiver(grant, receiverId); await ready();
    return storage.transaction(async (db) => {
      requireReceiver(grant, receiverId);
      if (!(await db.get(`SELECT g.id FROM mail_live_grants g WHERE g.id=? AND g.revoked_at IS NULL AND g.expires_at>?
        AND (g.parent_grant_id IS NULL OR EXISTS(SELECT 1 FROM mail_live_grants p WHERE p.id=g.parent_grant_id AND p.revoked_at IS NULL AND p.expires_at>?))`, [grant.id, now(), now()]))) fail("UNAUTHORIZED", "展示授权已失效", 401);
      const t = await topic(db, grant.topic_id!), c = await channel(db, t.id);
      let snapshot: WindChimeLiveSnapshot | null = null;
      if (!t.archivedAt && c.runtime_epoch === epoch && c.activation > r.joinedActivation && c.current_snapshot) {
        const row = await db.get<{ payload_json: string; message_id: string; source_hash: string }>(`SELECT s.* FROM mail_live_snapshots s JOIN mail_live_drafts d ON d.snapshot_id=s.id
          JOIN mail_messages m ON m.id=s.message_id WHERE s.id=? AND s.topic_id=? AND d.status='approved' AND m.deleted_at IS NULL AND m.topic_id=?`, [c.current_snapshot, t.id, t.id]);
        if (row) {
          const message = await db.get<SourceRow>("SELECT * FROM mail_messages WHERE id=? AND topic_id=? AND deleted_at IS NULL", [row.message_id, t.id]);
          if (message && (await source(db, message)).hash === row.source_hash) snapshot = JSON.parse(row.payload_json);
        }
      }
      requireReceiver(grant, receiverId);
      if (touch) r.lastSeen = now();
      return { receiverId, epoch, revision: c.revision, activation: c.activation, leaseMs: LEASE_MS, appearance: appearance(JSON.parse(c.appearance)), snapshot };
    });
  }
  async function displayAsset(grant: LiveGrantRow, receiverId: string, activation: number, id: string) {
    const value = await frame(grant, receiverId, false);
    if (value.activation !== activation || !value.snapshot?.assets.some((a) => a.id === id)) fail("ASSET_NOT_FOUND", "图片不可读取", 404);
    const row = await storage.get<LiveAssetRow>("SELECT * FROM mail_live_assets WHERE id=? AND topic_id=? AND message_id=?", [id, grant.topic_id, value.snapshot.messageId]);
    if (!row) fail("ASSET_NOT_FOUND", "图片不可读取", 404); return row!;
  }
  async function controlAsset(topicId: string, id: string) {
    await ready(); const t = await storage.transaction((db) => topic(db, topicId));
    const row = await storage.get<LiveAssetRow>("SELECT a.* FROM mail_live_assets a JOIN mail_messages m ON m.id=a.message_id WHERE a.id=? AND a.topic_id=? AND m.deleted_at IS NULL", [id, t.id]);
    if (!row) fail("ASSET_NOT_FOUND", "图片不存在", 404); return row!;
  }
  async function rateLimit(scope: string, max: number, windowMs: number) {
    await ready();
    await storage.transaction(async (db) => {
      await db.run("DELETE FROM mail_rate_limit_hits WHERE scope_key LIKE 'live:%' AND hit_at<?", [now() - 86400000]);
      const row = await db.get<{n:number}>("SELECT COUNT(*) n FROM mail_rate_limit_hits WHERE scope_key=? AND hit_at>?", ["live:" + scope, now() - windowMs]);
      if ((row?.n ?? 0) >= max) fail("RATE_LIMITED", "请求过于频繁", 429);
      await db.run("INSERT INTO mail_rate_limit_hits(scope_key,hit_at) VALUES(?,?)", ["live:" + scope, now()]);
    });
  }
  async function requestDevice(deviceName: string, challenge: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) fail("INVALID_CHALLENGE", "需要 PKCE S256 challenge");
    await ready(); const code = liveSecret(), userCode = liveSecret().replace(/[^A-Z0-9]/gi, "").slice(0, 8).toUpperCase();
    await storage.run("DELETE FROM mail_live_devices WHERE expires_at<=?", [now()]);
    await storage.run("INSERT INTO mail_live_devices(device_hash,user_code,device_name,challenge,expires_at) VALUES(?,?,?,?,?)", [liveHash(code), userCode, deviceName.slice(0,100), challenge, now() + 600000]);
    return { deviceCode: code, userCode, expiresAt: new Date(now()+600000).toISOString(), interval: 2 };
  }
  async function approveDevice(userCode: string, topicId: string) {
    await ready(); const t = await storage.transaction((db) => topic(db, topicId));
    const result = await storage.run("UPDATE mail_live_devices SET topic_id=? WHERE user_code=? AND topic_id IS NULL AND consumed_at IS NULL AND expires_at>?", [t.id, userCode.toUpperCase(), now()]);
    if (!result.changes) fail("DEVICE_NOT_FOUND", "配对码已过期或已使用", 404); return { ok: true as const };
  }
  async function pollDevice(deviceCode: string, verifier: string) {
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) fail("INVALID_VERIFIER", "PKCE verifier 无效");
    await ready();
    return storage.transaction(async (db) => {
      const row = await db.get<{ challenge:string; topic_id:string|null; device_name:string; consumed_at:number|null; expires_at:number }>("SELECT * FROM mail_live_devices WHERE device_hash=?", [liveHash(deviceCode)]);
      if (!row || row.expires_at <= now() || row.consumed_at !== null) fail("DEVICE_EXPIRED", "配对已过期或已完成", 410);
      if (row!.challenge !== createHash("sha256").update(verifier).digest("base64url")) fail("INVALID_VERIFIER", "配对校验失败", 403);
      if (!row!.topic_id) return { status: "pending" as const };
      const token = "wc_ctl_" + liveSecret(), expires = now()+30*86400000;
      await db.run("INSERT INTO mail_live_grants(id,token_hash,kind,topic_id,label,expires_at) VALUES(?,?,'control',?,?,?)", [randomUUID(), liveHash(token), row!.topic_id, row!.device_name, expires]);
      await db.run("UPDATE mail_live_devices SET consumed_at=? WHERE device_hash=?", [now(), liveHash(deviceCode)]);
      return { status: "approved" as const, token, topicId: row!.topic_id, expiresAt: new Date(expires).toISOString() };
    });
  }
  async function bindingChallenge(topicId: string, siteOrigin: string) {
    await ready(); const t = await storage.transaction((db) => topic(db, topicId)), nonce = liveSecret();
    await storage.run("INSERT INTO mail_live_nonces(nonce_hash,topic_id,expires_at) VALUES(?,?,?)", [liveHash(nonce), t.id, now()+300000]);
    return { nonce, siteId: await siteId(), topicId: t.id, siteOrigin, expiresAt: new Date(now()+300000).toISOString() };
  }
  async function consumeProof(db: WindChimeSqlExecutor, proof: LiveProof) {
    if (await db.get("SELECT jti FROM mail_live_proofs WHERE jti=?", [proof.jti])) fail("PROOF_REPLAYED", "平台凭据已经使用", 409);
    await db.run("INSERT INTO mail_live_proofs(jti,expires_at) VALUES(?,?)", [proof.jti, proof.exp*1000]);
    await db.run("DELETE FROM mail_live_proofs WHERE expires_at<?", [now()-600000]);
  }
  async function bind(topicId: string, proof: LiveProof) {
    await ready(); if (proof.kind !== "binding" || proof.siteId !== await siteId()) fail("INVALID_PROOF", "平台绑定不匹配", 403);
    return storage.transaction(async (db) => {
      const t = await topic(db, topicId); if (proof.topicId !== t.id || !proof.nonce) fail("INVALID_PROOF", "平台信箱不匹配", 403);
      const result = await db.run("DELETE FROM mail_live_nonces WHERE nonce_hash=? AND topic_id=? AND expires_at>?", [liveHash(proof.nonce!), t.id, now()]);
      if (!result.changes) fail("INVALID_NONCE", "绑定请求已过期或使用", 403);
      await consumeProof(db, proof);
      await db.run("UPDATE mail_live_grants SET revoked_at=? WHERE binding_id IN(SELECT binding_id FROM mail_live_bindings WHERE topic_id=?)", [now(), t.id]);
      await db.run("INSERT INTO mail_live_bindings(topic_id,binding_id,bili_subject,session_id) VALUES(?,?,?,?) ON CONFLICT(topic_id) DO UPDATE SET binding_id=excluded.binding_id,bili_subject=excluded.bili_subject,session_id=excluded.session_id", [t.id, proof.bindingId, proof.biliSubject, proof.sessionId]);
      return { ok: true as const, bindingId: proof.bindingId };
    });
  }
  async function validateBinding(db: WindChimeSqlExecutor, proof: LiveProof) {
    const b = await db.get<{binding_id:string;bili_subject:string}>("SELECT * FROM mail_live_bindings WHERE topic_id=?", [proof.topicId]);
    if (!b || b.binding_id !== proof.bindingId || b.bili_subject !== proof.biliSubject) fail("BINDING_NOT_FOUND", "平台绑定未获批准", 403);
  }
  async function exchange(proof: LiveProof, existing?: LiveGrantRow) {
    await ready(); if (proof.kind !== "display" || proof.siteId !== await siteId()) fail("INVALID_PROOF", "平台凭据不匹配", 403);
    return storage.transaction(async (db) => {
      await validateBinding(db, proof); await consumeProof(db, proof);
      if (existing) {
        if (existing.binding_id !== proof.bindingId || existing.platform_session !== proof.sessionId || existing.topic_id !== proof.topicId) fail("SESSION_CHANGED", "平台会话已改变，需要重新连接", 409);
        await db.run("UPDATE mail_live_grants SET expires_at=? WHERE id=? AND revoked_at IS NULL", [now()+120000, existing.id]);
        return { topicId: existing.topic_id, expiresAt: new Date(now()+120000).toISOString() };
      }
      const token = "wc_disp_"+liveSecret(), expires = now()+120000;
      await db.run("INSERT INTO mail_live_grants(id,token_hash,kind,topic_id,label,expires_at,binding_id,platform_session) VALUES(?,?,'display',?,'Bilibili H5',?,?,?)", [randomUUID(), liveHash(token), proof.topicId, expires, proof.bindingId, proof.sessionId]);
      return { token, topicId: proof.topicId, expiresAt: new Date(expires).toISOString() };
    });
  }
  async function validateLease(grant: LiveGrantRow, proof: LiveProof) {
    if (!grant.binding_id) return;
    if (proof.kind !== "lease" || proof.siteId !== await siteId() || proof.topicId !== grant.topic_id || proof.bindingId !== grant.binding_id || proof.sessionId !== grant.platform_session) fail("PLATFORM_UNCONFIRMED", "平台连接不可确认", 401);
    await storage.transaction((db) => validateBinding(db, proof));
  }
  async function unbind(topicId: string) {
    await ready(); return storage.transaction(async (db) => {
      const t = await topic(db, topicId);
      await db.run("UPDATE mail_live_grants SET revoked_at=? WHERE binding_id IN(SELECT binding_id FROM mail_live_bindings WHERE topic_id=?)", [now(), t.id]);
      await db.run("DELETE FROM mail_live_bindings WHERE topic_id=?", [t.id]); return { ok: true as const };
    });
  }
  return { siteId, state, action, createGrant, authenticate, listGrants, controlIdentity, revokeGrant, open, frame, displayAsset, controlAsset, rateLimit, requestDevice, approveDevice, pollDevice, bindingChallenge, bind, exchange, validateLease, unbind, epoch, leaseMs: LEASE_MS };
}
