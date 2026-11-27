'use client';
import { useEffect, useRef, useState } from 'react';
import type { WindChimeLiveClient } from '../client/live.js';
import type { WindChimeLiveDraft, WindChimeLiveMessage } from '../core/live.js';
import type { useWindChimeLiveControl } from '../react/live.js';
import { OnAirTeleprompter } from './Teleprompter.js';
import { ImageRedactorModal } from './ImageRedactorModal.js';
import type {
  WindChimeDisplayScrollCommand,
  WindChimeDisplayScrollMetrics,
} from './scroll-loop.js';

type Studio = ReturnType<typeof useWindChimeLiveControl>;

export type BlindBoxContentFilter = 'all' | 'media' | 'text';
export type BlindBoxDrawOrder = 'oldest' | 'newest' | 'random';

export function filterAndOrderPending(
  pending: readonly WindChimeLiveMessage[],
  contentFilter: BlindBoxContentFilter,
  drawOrder: BlindBoxDrawOrder,
): WindChimeLiveMessage[] {
  const filtered = pending.filter(m => {
    const hasMedia = m.source.assets.length > 0 || m.draft.assets.length > 0;
    if (contentFilter === 'media') return hasMedia;
    if (contentFilter === 'text') return !hasMedia;
    return true;
  });
  if (drawOrder === 'newest') {
    return [...filtered].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  if (drawOrder === 'oldest') {
    return [...filtered].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }
  return filtered;
}

export type BlindBoxHistoryEntry = {
  id: string;
  playedAt: string;
  dateKey: string;
  nickname: string | null;
  textSnippet: string;
  topicTitle: string;
  assetCount: number;
  obsStreamMs?: number;
  obsRecordMs?: number;
};

export type BlindBoxTimelineInfo = {
  anchorStartedAt: string | null;
  anchorSource: string | null;
  anchorLabel: string;
  offsetSec: number;
  activeLive: boolean;
  streamTrack: { label: string; startedAt: string; active: boolean } | null;
  recordTrack: { label: string; startedAt: string; active: boolean } | null;
  bilibiliTrack: { label: string; startedAt: string; active: boolean } | null;
};

export type BlindBoxStudioProps = {
  client: WindChimeLiveClient;
  topicId: string;
  studio: Studio;
  compact?: boolean;
  blockedTermsEnabled?: boolean;
  scrollState?: WindChimeDisplayScrollMetrics | null;
  onScrollDisplay?: (command: WindChimeDisplayScrollCommand) => Promise<void> | void;
  spotlightAssetId?: string | null;
  onToggleSpotlight?: (assetId: string | null) => Promise<void> | void;
  onOpenDisplay?: () => Promise<void>;
  onHideDisplay?: () => Promise<void>;
  onOpenObsGuide?: () => void;
  obsClientCount?: number;
  testCardActive?: boolean;
  onToggleTestCard?: (active: boolean) => Promise<void>;
  randomDrawEnabled?: boolean;
  clearOnBlindDraw?: boolean;
  onToggleClearOnBlindDraw?: (enabled: boolean) => void;
  onBlockMessage?: (messageId: string) => Promise<boolean | void>;
  onConfirmDiscard?: () => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
  playedIds: string[];
  sessionHistory?: BlindBoxHistoryEntry[];
  streamStartedAt?: string | null;
  timelineInfo?: BlindBoxTimelineInfo | null;
  onSetStreamStartedAt?: (iso: string | null) => Promise<void>;
  onSetTimelineOffset?: (sec: number) => Promise<void>;
  onSyncTimeline?: (track?: 'stream' | 'record' | 'bilibili') => Promise<void>;
  onPickRecordingFile?: () => Promise<void>;
  onCopyChapters?: () => Promise<boolean>;
  onExportHistory?: (format: 'md' | 'csv' | 'chapters') => Promise<void>;
  onClearHistory?: () => Promise<void>;
  onEndShow: () => void;
  onPrevLetter: () => void;
  canPrev: boolean;
  autoMarkRead: boolean;
  onToggleAutoMarkRead: (enabled: boolean) => void;
};

function BlindBoxUnboxCard({
  client,
  topicId,
  message,
  studio,
  blockedTermsEnabled,
  receivers,
  onOpenDisplay,
  onToggleTestCard,
  testCardActive,
  onBlockMessage,
  onDirtyChange,
  onDone,
  onPutBack,
}: {
  client: WindChimeLiveClient;
  topicId: string;
  message: WindChimeLiveMessage;
  studio: Studio;
  blockedTermsEnabled: boolean;
  receivers: number;
  onOpenDisplay?: () => void;
  onToggleTestCard?: (active: boolean) => void;
  testCardActive?: boolean;
  onBlockMessage?: (messageId: string) => Promise<boolean | void>;
  onDirtyChange?: (dirty: boolean) => void;
  onDone: () => void;
  onPutBack: () => void;
}) {
  const [draft, setDraft] = useState<WindChimeLiveDraft>(() => structuredClone(message.draft));
  const [basis, setBasis] = useState(() => ({
    draft: structuredClone(message.draft),
    revision: message.draftRevision,
  }));
  const [editing, setEditing] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [failedAssetIds, setFailedAssetIds] = useState<Record<string, boolean>>({});
  const [assetRetry, setAssetRetry] = useState(0);
  const [localPreviewUrls, setLocalPreviewUrls] = useState<Record<string, string>>({});
  const [redactedIds, setRedactedIds] = useState<Record<string, boolean>>({});
  const localOwnedUrlsRef = useRef<string[]>([]);
  const [redactingIndex, setRedactingIndex] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [localError, setLocalError] = useState('');
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    return () => {
      for (const url of localOwnedUrlsRef.current) {
        try { URL.revokeObjectURL(url); } catch {}
      }
      localOwnedUrlsRef.current = [];
    };
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(basis.draft);
  const conflict = basis.revision !== message.draftRevision;
  const differsFromSource = JSON.stringify(draft) !== JSON.stringify(message.source);

  useEffect(() => {
    if (!dirty && message.draftRevision !== basis.revision) {
      setDraft(structuredClone(message.draft));
      setBasis({ draft: structuredClone(message.draft), revision: message.draftRevision });
    }
  }, [dirty, message.draft, message.draftRevision, basis.revision]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const assetSig = [...new Set([...message.source.assets.map(a => a.id), ...message.draft.assets.map(a => a.id)])].join('|');
  useEffect(() => {
    if (
      !assetSig ||
      typeof client.asset !== 'function' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      setAssetUrls({});
      setFailedAssetIds({});
      return;
    }
    const ids = [...new Set(assetSig.split('|').filter(Boolean))];
    let cancelled = false;
    const controller = new AbortController();
    const owned = new Set<string>();
    const release = () => {
      cancelled = true;
      controller.abort();
      owned.forEach(url => URL.revokeObjectURL(url));
      owned.clear();
    };
    setAssetUrls({});
    setFailedAssetIds({});
    void Promise.allSettled(
      ids.map(async id => {
        const blob = await client.asset(topicId, id, controller.signal);
        if (
          !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) ||
          blob.size > 5 * 1024 * 1024
        ) {
          throw new Error('图片格式无效');
        }
        if (cancelled || controller.signal.aborted) throw new Error('cancelled');
        const url = URL.createObjectURL(blob);
        owned.add(url);
        return [id, url] as const;
      }),
    ).then(results => {
      if (cancelled) return;
      const entries: Array<readonly [string, string]> = [];
      const failed: Record<string, boolean> = {};
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') entries.push(r.value);
        else failed[ids[idx]!] = true;
      });
      setAssetUrls(Object.fromEntries(entries));
      setFailedAssetIds(failed);
    });
    return release;
  }, [client, topicId, message.id, assetSig, assetRetry]);

  const persistAndApprove = async () => {
    setLocalError('');
    if (!draft.text.trim()) {
      setLocalError('展示正文不能为空');
      return null;
    }
    if (conflict) {
      setLocalError('该来信已在其他控制端更新，请先确认新版本后再继续。');
      return null;
    }
    let approveDraftRev = basis.revision;
    if (dirty) {
      const savedState = await studio.actWithResult({
        action: 'draft',
        messageId: message.id,
        expectedDraftRevision: basis.revision,
        draft: structuredClone(draft),
      });
      if (!savedState) return null;
      const saved = savedState.messages.find(item => item.id === message.id);
      if (!saved) return null;
      approveDraftRev = saved.draftRevision;
      setBasis({ draft: structuredClone(saved.draft), revision: saved.draftRevision });
      onDirtyChange?.(false);
    }
    return studio.actWithResult({
      action: 'approve',
      messageId: message.id,
      expectedDraftRevision: approveDraftRev,
    });
  };

  const approveAndShow = async () => {
    const approved = await persistAndApprove();
    if (!approved) return;
    await studio.actWithResult({ action: 'show', messageId: message.id });
    onDone();
  };

  const approveOnly = async () => {
    const approved = await persistAndApprove();
    if (approved) onDone();
  };

  const rejectLetter = async () => {
    setLocalError('');
    const result = await studio.actWithResult({
      action: 'reject',
      messageId: message.id,
      expectedDraftRevision: basis.revision,
    });
    if (result) {
      onDirtyChange?.(false);
      onDone();
    }
  };

  const blockSender = async () => {
    if (!onBlockMessage || blocking) return;
    setLocalError('');
    setBlocking(true);
    try {
      const blocked = await onBlockMessage(message.id);
      if (blocked === false) return;
      onDirtyChange?.(false);
      onDone();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : '屏蔽失败');
    } finally {
      setBlocking(false);
    }
  };

  const busy = studio.pending || blocking;
  const resolveAssetUrl = (id: string) => localPreviewUrls[id] ?? assetUrls[id];
  const assetsMissing = draft.assets.some(a => !resolveAssetUrl(a.id));
  const assetsChangedFromSource =
    JSON.stringify(draft.assets.map(a => a.id)) !== JSON.stringify(message.source.assets.map(a => a.id));
  const canRedact = typeof client.upload === 'function';
  const handleSaveRedacted = async (index: number, file: File) => {
    setLocalError('');
    const uploaded = await client.upload(topicId, message.id, file);
    const previewUrl = URL.createObjectURL(file);
    localOwnedUrlsRef.current.push(previewUrl);
    setLocalPreviewUrls(prev => ({ ...prev, [uploaded.id]: previewUrl }));
    setRedactedIds(prev => ({ ...prev, [uploaded.id]: true }));
    setRevealed(prev => ({ ...prev, [uploaded.id]: true }));
    setDraft(before => ({
      ...before,
      assets: before.assets.map((item, at) => (at === index ? { id: uploaded.id, caption: item.caption } : item)),
    }));
    setRedactingIndex(null);
  };
  const charCount = draft.text.replace(/\s+/g, '').length;
  const estSeconds = Math.max(5, Math.round(charCount / 4.5));
  const estReadLabel =
    estSeconds >= 60
      ? `${Math.floor(estSeconds / 60)}分${estSeconds % 60 ? `${estSeconds % 60}秒` : ''}`
      : `${estSeconds}秒`;

  return (
    <section className="wc-panel wc-bb-unbox" aria-label="私下拆封预览">
      <div className="wc-bb-private-banner" role="status">
        <strong>仅主播可见 · 尚未上屏</strong>
        <span>先扫一眼确认内容安全，点击「确认并直接上屏」才会展示给观众</span>
      </div>

      <div className="wc-pad wc-stack">
        {conflict ? (
          <div className="wc-error" role="alert">
            <strong>{`展示稿已在其他控制端更新为版本 ${message.draftRevision}。`}</strong>
            <div className="wc-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setDraft(structuredClone(message.draft));
                  setBasis({ draft: structuredClone(message.draft), revision: message.draftRevision });
                }}
              >
                载入最新版本，放弃本地改动
              </button>
              <button
                type="button"
                onClick={() => setBasis({ draft: structuredClone(message.draft), revision: message.draftRevision })}
              >
                确认新版本，保留我的编辑
              </button>
            </div>
          </div>
        ) : null}
        <div className="wc-bb-letter-head">
          <div>
            <h3>{draft.nickname || '匿名来信'}</h3>
            <div className="wc-bb-meta-row">
              <span>{new Date(message.createdAt).toLocaleString('zh-CN')}</span>
              <span className="wc-bb-stat-pill">{`约 ${charCount} 字 · 预计读 ${estReadLabel}`}</span>
              {draft.assets.length > 0 ? (
                <span className="wc-bb-stat-pill">{`${draft.assets.length} 张附图`}</span>
              ) : null}
            </div>
          </div>
          <div className="wc-actions">
            {blockedTermsEnabled && message.isFlagged ? (
              <span className="wc-tag rejected">敏感词标记</span>
            ) : null}
            {dirty ? <span className="wc-tag">已本地打码</span> : null}
            <button
              type="button"
              className="wc-subtle"
              aria-expanded={editing}
              onClick={() => setEditing(v => !v)}
            >
              {editing ? '收起打码编辑' : '✎ 快速打码 / 编辑'}
            </button>
          </div>
        </div>

        {!editing ? (
          <div className="wc-bb-reading">
            <div className="wc-bb-reading-text">{draft.text}</div>
            {draft.linkUrl ? (
              <div className="wc-bb-link-chip">附带外链（仅显示文字）：{draft.linkUrl}</div>
            ) : null}
          </div>
        ) : (
          <div className="wc-bb-edit-box wc-stack">
            <label>
              展示称呼
              <input
                value={draft.nickname ?? ''}
                maxLength={32}
                onChange={e => setDraft({ ...draft, nickname: e.target.value || null })}
              />
            </label>
            <label>
              展示正文
              <textarea
                value={draft.text}
                maxLength={1000}
                rows={6}
                onChange={e => setDraft({ ...draft, text: e.target.value })}
              />
            </label>
            <label>
              展示链接文字（留空即隐藏外链）
              <input
                value={draft.linkUrl ?? ''}
                maxLength={500}
                onChange={e => setDraft({ ...draft, linkUrl: e.target.value || null })}
              />
            </label>
            {differsFromSource ? (
              <div className="wc-actions">
                <button
                  type="button"
                  className="wc-subtle"
                  onClick={() => setDraft(structuredClone(message.source))}
                >
                  还原投稿原文
                </button>
              </div>
            ) : null}
          </div>
        )}

        {draft.assets.length > 0 ? (
          <div className="wc-bb-assets" aria-label="来信附图安全预览">
            <div className="wc-bb-assets-head">
              <strong>{`含 ${draft.assets.length} 张附图 · 默认模糊防突脸`}</strong>
              {assetsChangedFromSource && message.source.assets.length > 0 ? (
                <button
                  type="button"
                  className="wc-queue-small"
                  onClick={() => setDraft({ ...draft, assets: structuredClone(message.source.assets) })}
                >
                  恢复原始附图
                </button>
              ) : null}
            </div>
            <div className="wc-bb-asset-grid">
              {draft.assets.map((asset, index) => {
                const isRevealed = Boolean(revealed[asset.id]);
                const url = resolveAssetUrl(asset.id);
                const isRedactedCopy =
                  Boolean(redactedIds[asset.id]) ||
                  (message.source.assets.length > 0 && !message.source.assets.some(src => src.id === asset.id));
                return (
                  <div key={asset.id} className="wc-bb-asset-card">
                    <div className="wc-bb-asset-frame">
                      {url ? (
                        <img
                          src={url}
                          alt={asset.caption || `附图 ${index + 1}`}
                          className={isRevealed ? '' : 'is-blurred'}
                        />
                      ) : failedAssetIds[asset.id] ? (
                        <div className="wc-stack" style={{ alignItems: 'center', padding: 12 }}>
                          <span className="wc-muted">图片加载失败</span>
                          <button
                            type="button"
                            className="wc-queue-small"
                            onClick={() => setAssetRetry(n => n + 1)}
                          >
                            重试载入
                          </button>
                        </div>
                      ) : (
                        <span className="wc-muted">图片载入中…</span>
                      )}
                      {url && !isRevealed ? (
                        <button
                          type="button"
                          className="wc-bb-reveal-btn"
                          onClick={() => setRevealed(prev => ({ ...prev, [asset.id]: true }))}
                        >
                          私下查看原图
                        </button>
                      ) : null}
                    </div>
                    {asset.caption ? <p className="wc-muted">{asset.caption}</p> : null}
                    {isRedactedCopy ? <span className="wc-tag approved">已局部打码</span> : null}
                    <div className="wc-actions">
                      {canRedact ? (
                        <button
                          type="button"
                          className="wc-queue-small"
                          disabled={!url || busy}
                          onClick={() => setRedactingIndex(index)}
                        >
                          🖌 局部打码
                        </button>
                      ) : null}
                      {isRevealed ? (
                        <button
                          type="button"
                          className="wc-queue-small"
                          onClick={() => setRevealed(prev => ({ ...prev, [asset.id]: false }))}
                        >
                          重新模糊
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="wc-queue-small"
                        onClick={() =>
                          setDraft(before => ({
                            ...before,
                            assets: before.assets.filter((_, at) => at !== index),
                          }))
                        }
                      >
                        移出本次上屏
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : assetsChangedFromSource && message.source.assets.length > 0 ? (
          <div className="wc-actions">
            <span className="wc-muted">已移除全部附图，本次将仅展示文字。</span>
            <button
              type="button"
              className="wc-queue-small"
              onClick={() => setDraft({ ...draft, assets: structuredClone(message.source.assets) })}
            >
              恢复原始附图
            </button>
          </div>
        ) : null}
        {redactingIndex !== null && draft.assets[redactingIndex] && resolveAssetUrl(draft.assets[redactingIndex]!.id) ? (
          <ImageRedactorModal
            imageUrl={resolveAssetUrl(draft.assets[redactingIndex]!.id)!}
            caption={draft.assets[redactingIndex]!.caption}
            onCancel={() => setRedactingIndex(null)}
            onSave={file => handleSaveRedacted(redactingIndex, file)}
          />
        ) : null}

        {receivers === 0 ? (
          <div className="wc-display-guide" role="status">
            <span>尚未打开展示窗口，打开后即可一键上屏。</span>
            <div className="wc-actions">
              {onOpenDisplay ? (
                <button type="button" className="wc-primary" onClick={onOpenDisplay}>
                  打开独立展示窗口
                </button>
              ) : null}
              {onToggleTestCard ? (
                <button
                  type="button"
                  onClick={() => onToggleTestCard(!testCardActive)}
                >
                  {testCardActive ? '关闭测试卡' : '发测试卡对位 OBS'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {localError ? <p className="wc-error" role="alert">{localError}</p> : null}

        <div className="wc-bb-decision-bar">
          <button
            type="button"
            className="wc-primary wc-bb-go-live"
            disabled={busy || conflict || !studio.connected || receivers === 0 || !draft.text.trim() || assetsMissing}
            onClick={() => void approveAndShow()}
          >
            {dirty ? '✓ 保存并直接上屏' : '✓ 确认并直接上屏'}
          </button>
          <button
            type="button"
            disabled={busy || conflict || !studio.connected || !draft.text.trim() || assetsMissing}
            onClick={() => void approveOnly()}
          >
            仅加入待播
          </button>
          <button
            type="button"
            disabled={busy || conflict || !studio.connected}
            onClick={() => void rejectLetter()}
          >
            ✕ 跳过拒绝
          </button>
          {onBlockMessage ? (
            <button
              type="button"
              className="wc-danger"
              disabled={busy || !studio.connected}
              onClick={() => void blockSender()}
            >
              拒收并拉黑
            </button>
          ) : null}
          <button
            type="button"
            className="wc-subtle"
            style={{ marginLeft: 'auto' }}
            disabled={busy}
            onClick={onPutBack}
          >
            放回未拆
          </button>
        </div>
      </div>
    </section>
  );
}

export function BlindBoxStudio(props: BlindBoxStudioProps) {
  const {
    client,
    topicId,
    studio,
    compact = false,
    blockedTermsEnabled = false,
    scrollState,
    onScrollDisplay,
    spotlightAssetId,
    onToggleSpotlight,
    onOpenDisplay,
    onHideDisplay,
    onOpenObsGuide,
    obsClientCount = 0,
    testCardActive = false,
    onToggleTestCard,
    randomDrawEnabled = false,
    clearOnBlindDraw = false,
    onToggleClearOnBlindDraw,
    onBlockMessage,
    onConfirmDiscard,
    onDirtyChange,
    playedIds,
    sessionHistory,
    streamStartedAt = null,
    timelineInfo = null,
    onSetStreamStartedAt,
    onSetTimelineOffset,
    onSyncTimeline,
    onPickRecordingFile,
    onCopyChapters,
    onExportHistory,
    onClearHistory,
    onEndShow,
    onPrevLetter,
    canPrev,
    autoMarkRead,
    onToggleAutoMarkRead,
  } = props;

  const [unboxedId, setUnboxedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [unboxDirty, setUnboxDirty] = useState(false);
  const [chaptersCopied, setChaptersCopied] = useState(false);
  const [contentFilter, setContentFilter] = useState<BlindBoxContentFilter>('all');
  const [drawOrder, setDrawOrder] = useState<BlindBoxDrawOrder>('oldest');
  const [offsetDraft, setOffsetDraft] = useState(() => String(timelineInfo?.offsetSec ?? 0));
  const [offsetFocused, setOffsetFocused] = useState(false);
  const drawnPoolRef = useRef(new Set<string>());
  const lastPutBackRef = useRef<string | null>(null);
  const chaptersTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!offsetFocused) setOffsetDraft(String(timelineInfo?.offsetSec ?? 0));
  }, [timelineInfo?.offsetSec, offsetFocused]);

  useEffect(() => {
    return () => {
      if (chaptersTimerRef.current !== null) clearTimeout(chaptersTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setUnboxedId(null);
    setUnboxDirty(false);
    setActionError('');
    setChaptersCopied(false);
    setContentFilter('all');
    drawnPoolRef.current.clear();
    lastPutBackRef.current = null;
  }, [client, topicId]);

  useEffect(() => {
    onDirtyChange?.(unboxDirty);
  }, [unboxDirty, onDirtyChange]);

  const state = studio.state;
  const allMessages = state?.messages ?? [];
  const pending = allMessages.filter(m => m.status === 'pending');
  const mediaPendingCount = pending.filter(m => m.source.assets.length > 0 || m.draft.assets.length > 0).length;
  const textPendingCount = pending.length - mediaPendingCount;
  const filteredPending = filterAndOrderPending(pending, contentFilter, drawOrder);
  const queue =
    state?.queue
      .map(id => allMessages.find(m => m.id === id))
      .filter((m): m is WindChimeLiveMessage => !!m) ?? [];
  const playedSet = new Set(playedIds);
  const unplayedQueue = queue.filter(m => !playedSet.has(m.id));
  const onAir = state?.current ? allMessages.find(m => m.id === state.current!.messageId) ?? null : null;
  const unboxed = unboxedId ? pending.find(m => m.id === unboxedId) ?? null : null;

  const safeOpenDisplay = onOpenDisplay
    ? () => {
        setActionError('');
        void onOpenDisplay().catch(e => setActionError(e instanceof Error ? e.message : '无法打开展示窗口'));
      }
    : undefined;

  const safeToggleTestCard = onToggleTestCard
    ? (active: boolean) => {
        setActionError('');
        void onToggleTestCard(active).catch(e => setActionError(e instanceof Error ? e.message : '无法切换测试卡'));
      }
    : undefined;

  const safeHide = () => {
    setActionError('');
    if (onHideDisplay) {
      void onHideDisplay().catch(e => setActionError(e instanceof Error ? e.message : '隐藏失败'));
    } else {
      void studio.act({ action: 'hide' });
    }
  };

  const drawLetter = async (forceRandom: boolean) => {
    if (!filteredPending.length) return;
    setActionError('');
    if (clearOnBlindDraw && state?.current) {
      try {
        if (onHideDisplay) await onHideDisplay();
        else await studio.act({ action: 'hide' });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : '清空画面失败');
        return;
      }
    }
    const unseen = filteredPending.filter(m => !drawnPoolRef.current.has(m.id));
    let candidates: WindChimeLiveMessage[];
    if (unseen.length > 0) {
      candidates = unseen;
    } else {
      drawnPoolRef.current.clear();
      const skipId = unboxedId ?? lastPutBackRef.current;
      candidates = filteredPending.length > 1 && skipId
        ? filteredPending.filter(m => m.id !== skipId)
        : filteredPending;
    }
    const useRandom = forceRandom || drawOrder === 'random';
    const chosen = useRandom
      ? candidates[Math.floor(Math.random() * candidates.length)]!
      : candidates[0]!;
    drawnPoolRef.current.add(chosen.id);
    lastPutBackRef.current = null;
    setUnboxedId(chosen.id);
  };

  const handlePutBack = async () => {
    if (unboxDirty) {
      const ok = await (onConfirmDiscard?.() ?? Promise.resolve(typeof window !== 'undefined' && window.confirm('当前拆封来信有未保存的打码/编辑，放回未拆将放弃改动，是否继续？')));
      if (!ok) return;
    }
    if (unboxed) lastPutBackRef.current = unboxed.id;
    setUnboxDirty(false);
    setUnboxedId(null);
  };

  const effectiveReceivers = (state?.receivers ?? 0) + (state?.receivers ? 0 : obsClientCount);
  const filterLabel = contentFilter === 'media' ? '仅含附图' : contentFilter === 'text' ? '仅纯文字' : '全部未拆';

  return (
    <div className={`wc-bb-studio${compact ? ' is-compact' : ''}`} aria-label="盲盒拆信台">
      <div className="wc-panel wc-bb-topbar">
        <div className="wc-bb-topbar-row">
          <div className="wc-bb-counters">
            <span className="wc-bb-pill is-pending">{`未拆来信 ${pending.length} 封`}</span>
            <span className="wc-bb-pill">{`已批准待播 ${queue.length} 封 · 剩 ${unplayedQueue.length} 封未播`}</span>
          </div>
          <div className="wc-actions">
            {onToggleClearOnBlindDraw ? (
              <label className="wc-checkbox wc-inline-toggle">
                <input
                  type="checkbox"
                  checked={clearOnBlindDraw}
                  onChange={e => onToggleClearOnBlindDraw(e.target.checked)}
                />
                <span>拆封时先清空观众画面</span>
              </label>
            ) : null}
          </div>
        </div>
        <div className="wc-bb-filter-row">
          <div className="wc-bb-filter-group" role="group" aria-label="盲盒内容筛选">
            {(
              [
                ['all', `全部未拆 (${pending.length})`],
                ['media', `仅含附图 (${mediaPendingCount})`],
                ['text', `仅纯文字 (${textPendingCount})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={contentFilter === key}
                onClick={() => setContentFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="wc-bb-order-select">
            <span className="wc-muted">顺序</span>
            <select
              aria-label="盲盒抽信顺序"
              value={drawOrder}
              onChange={e => setDrawOrder(e.target.value as BlindBoxDrawOrder)}
            >
              <option value="oldest">按先后</option>
              <option value="newest">优先最新</option>
              <option value="random">随机抽取</option>
            </select>
          </label>
        </div>
      </div>

      {actionError ? <p className="wc-error" role="alert">{actionError}</p> : null}

      {unboxed ? (
        <BlindBoxUnboxCard
          key={`${topicId}:${unboxed.id}`}
          client={client}
          topicId={topicId}
          message={unboxed}
          studio={studio}
          blockedTermsEnabled={blockedTermsEnabled}
          receivers={effectiveReceivers}
          onOpenDisplay={safeOpenDisplay}
          onToggleTestCard={safeToggleTestCard}
          testCardActive={testCardActive}
          onBlockMessage={onBlockMessage}
          onDirtyChange={setUnboxDirty}
          onDone={() => { setUnboxDirty(false); setUnboxedId(null); }}
          onPutBack={() => void handlePutBack()}
        />
      ) : onAir ? (
        <div className="wc-bb-live-stage">
          {onScrollDisplay ? (
            <OnAirTeleprompter
              client={client}
              topicId={topicId}
              message={onAir}
              scrollState={scrollState}
              onScrollDisplay={onScrollDisplay}
              spotlightAssetId={spotlightAssetId}
              onToggleSpotlight={onToggleSpotlight}
              compact={compact}
            />
          ) : (
            <section className="wc-panel wc-pad">
              <span className="wc-tag approved">正在播出</span>
              <h3 style={{ marginTop: 8 }}>{onAir.draft.nickname || '匿名来信'}</h3>
              <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{onAir.draft.text}</p>
            </section>
          )}
          <section className="wc-panel wc-bb-stage-bar">
            <div className="wc-actions">
              <button
                type="button"
                className="wc-primary wc-bb-draw-btn"
                disabled={!studio.connected || studio.pending || !filteredPending.length}
                onClick={() => void drawLetter(false)}
              >
                {filteredPending.length
                  ? `${drawOrder === 'random' ? '随机拆下一封' : '拆下一封'} ✉（剩 ${filteredPending.length}）`
                  : contentFilter !== 'all' && pending.length > 0
                    ? `「${filterLabel}」已拆完`
                    : '暂无更多未拆来信'}
              </button>
              {!filteredPending.length && contentFilter !== 'all' && pending.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setContentFilter('all')}
                >
                  {`切回全部未拆（${pending.length}）`}
                </button>
              ) : null}
              {randomDrawEnabled && drawOrder !== 'random' ? (
                <button
                  type="button"
                  disabled={!studio.connected || studio.pending || !filteredPending.length}
                  onClick={() => void drawLetter(true)}
                >
                  随机拆一封
                </button>
              ) : null}
              {unplayedQueue.length > 0 ? (
                <button
                  type="button"
                  disabled={!studio.connected || !effectiveReceivers || studio.pending}
                  onClick={() => void studio.act({ action: 'next' })}
                >
                  下一封已批准 →
                </button>
              ) : null}
              <button
                type="button"
                disabled={!studio.connected || !effectiveReceivers || studio.pending || !canPrev}
                onClick={onPrevLetter}
              >
                ← 上一封
              </button>
              <button type="button" className="wc-danger" style={{ marginLeft: 'auto' }} onClick={safeHide}>
                ■ 一键隐藏
              </button>
            </div>
          </section>
        </div>
      ) : (
        <section className="wc-panel wc-bb-standby">
          <div className="wc-bb-standby-inner">
            <div className="wc-bb-badge-count">{filteredPending.length}</div>
            <h3>
              {!state
                ? '正在连接信箱…'
                : filteredPending.length > 0
                  ? contentFilter === 'all'
                    ? `还有 ${filteredPending.length} 封未拆来信`
                    : `「${filterLabel}」还有 ${filteredPending.length} 封未拆`
                  : pending.length > 0
                    ? `当前筛选（${filterLabel}）暂无未拆来信`
                    : queue.length > 0
                      ? `全部新来信已拆完 · 待播列表有 ${queue.length} 封`
                      : '暂时还没有新来信'}
            </h3>
            <p className="wc-muted">
              {filteredPending.length === 0 && pending.length > 0
                ? `信箱内还有 ${pending.length} 封其他类型未拆来信，可一键切回全部未拆继续直播。`
                : '点击「拆下一封」只会在你的私人屏幕上拆封，保留初见惊喜感且绝不会提前泄露给观众；确认无雷后再一键上屏。'}
            </p>
            {state && effectiveReceivers === 0 ? (
              <div className="wc-display-guide" role="status" style={{ maxWidth: 540, width: '100%' }}>
                <span>尚未连接展示端，可打开独立展示窗口或使用本机 OBS 浏览器源对好位置。</span>
                <div className="wc-actions">
                  {safeOpenDisplay ? (
                    <button type="button" className="wc-primary" onClick={safeOpenDisplay}>
                      打开独立展示窗口
                    </button>
                  ) : null}
                  {onOpenObsGuide ? (
                    <button type="button" onClick={onOpenObsGuide}>
                      OBS 浏览器源采集
                    </button>
                  ) : null}
                  {safeToggleTestCard ? (
                    <button type="button" onClick={() => safeToggleTestCard(!testCardActive)}>
                      {testCardActive ? '关闭测试卡' : '发测试卡对位 OBS'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="wc-actions wc-bb-standby-actions">
              {filteredPending.length === 0 && pending.length > 0 ? (
                <button
                  type="button"
                  className="wc-primary wc-bb-draw-btn"
                  onClick={() => setContentFilter('all')}
                >
                  {`切回全部未拆（${pending.length}）`}
                </button>
              ) : (
                <button
                  type="button"
                  className="wc-primary wc-bb-draw-btn"
                  disabled={!studio.connected || studio.pending || !filteredPending.length}
                  onClick={() => void drawLetter(false)}
                >
                  {drawOrder === 'random' ? '随机拆下一封 ✉' : '拆下一封 ✉'}
                </button>
              )}
              {randomDrawEnabled && drawOrder !== 'random' ? (
                <button
                  type="button"
                  disabled={!studio.connected || studio.pending || !filteredPending.length}
                  onClick={() => void drawLetter(true)}
                >
                  随机拆一封
                </button>
              ) : null}
              {queue.length > 0 ? (
                <button
                  type="button"
                  disabled={!studio.connected || !effectiveReceivers || studio.pending}
                  onClick={() => void studio.act({ action: 'next' })}
                >
                  播待播列表下一封 →
                </button>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {!compact ? (
      <details className="wc-panel wc-bb-history">
        <summary>
          <span>{`待播队列（${queue.length} 封）与本地播报复盘（${sessionHistory?.length ?? playedIds.length} 条）`}</span>
          <span className="wc-muted">展开可重新上屏、撤销批准、导出复盘或重置进度</span>
        </summary>
        <div className="wc-pad wc-stack">
          <div className="wc-actions" style={{ justifyContent: 'space-between' }}>
            <label className="wc-checkbox wc-inline-toggle">
              <input
                type="checkbox"
                checked={autoMarkRead}
                onChange={e => onToggleAutoMarkRead(e.target.checked)}
              />
              <span>上屏时自动标为已读</span>
            </label>
            <button type="button" className="wc-subtle" onClick={onEndShow}>
              重置本场进度
            </button>
          </div>
          {queue.length ? (
            <ol className="wc-queue">
              {queue.map((m, index) => (
                <li
                  key={m.id}
                  data-played={playedSet.has(m.id) ? 'true' : undefined}
                  aria-current={state?.current?.messageId === m.id}
                >
                  <div className="wc-mail-title">
                    <strong>{`${index + 1}. ${m.draft.nickname || '匿名来信'}`}</strong>
                    {state?.current?.messageId === m.id ? (
                      <span className="wc-tag approved">正在播出</span>
                    ) : playedSet.has(m.id) ? (
                      <span className="wc-tag wc-tag-played">已播</span>
                    ) : null}
                  </div>
                  <p className="wc-snippet">{m.draft.text}</p>
                  <div className="wc-actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="wc-primary wc-queue-small"
                      disabled={studio.pending || !studio.connected || !effectiveReceivers}
                      onClick={() => void studio.act({ action: 'show', messageId: m.id })}
                    >
                      上屏
                    </button>
                    <button
                      type="button"
                      className="wc-queue-small"
                      disabled={studio.pending || !studio.connected}
                      onClick={() => void studio.act({ action: 'revoke', messageId: m.id })}
                    >
                      撤销批准
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="wc-muted">本场还没有已批准的来信。</p>
          )}
          {sessionHistory ? (
            <>
              <div className="wc-rule" />
              <div className="wc-actions" style={{ justifyContent: 'space-between' }}>
                <strong>{`本机上屏复盘记录（共 ${sessionHistory.length} 条）`}</strong>
                <div className="wc-actions">
                  {onCopyChapters ? (
                    <button
                      type="button"
                      className="wc-primary wc-queue-small"
                      disabled={!sessionHistory.length}
                      onClick={() => {
                        void onCopyChapters()
                          .then(ok => {
                            if (ok) {
                              setChaptersCopied(true);
                              if (chaptersTimerRef.current !== null) clearTimeout(chaptersTimerRef.current);
                              chaptersTimerRef.current = setTimeout(() => {
                                chaptersTimerRef.current = null;
                                setChaptersCopied(false);
                              }, 2400);
                            }
                          })
                          .catch(() => {});
                      }}
                    >
                      {chaptersCopied ? '✓ 已复制 B站章节' : '📋 复制 B站章节'}
                    </button>
                  ) : null}
                  {onExportHistory ? (
                    <>
                      <button type="button" className="wc-queue-small" disabled={!sessionHistory.length} onClick={() => void onExportHistory('chapters')}>
                        导出章节 TXT
                      </button>
                      <button type="button" className="wc-queue-small" disabled={!sessionHistory.length} onClick={() => void onExportHistory('md')}>
                        导出 Markdown
                      </button>
                      <button type="button" className="wc-queue-small" disabled={!sessionHistory.length} onClick={() => void onExportHistory('csv')}>
                        导出 CSV
                      </button>
                    </>
                  ) : null}
                  {onClearHistory ? (
                    <button type="button" className="wc-subtle wc-queue-small" disabled={!sessionHistory.length} onClick={() => void onClearHistory()}>
                      清空记录
                    </button>
                  ) : null}
                </div>
              </div>
              {onSetStreamStartedAt || onSyncTimeline || onPickRecordingFile ? (
                <div className="wc-bb-timeline-bar">
                  <div className="wc-bb-timeline-row">
                    <div className="wc-bb-timeline-meta">
                      <span
                        className="wc-bb-timeline-dot"
                        data-active={streamStartedAt || timelineInfo?.activeLive ? 'true' : undefined}
                        aria-hidden="true"
                      />
                      <span>
                        {streamStartedAt
                          ? `${timelineInfo?.anchorLabel ? `${timelineInfo.anchorLabel} · ` : '开播基准 · '}${new Date(streamStartedAt).toLocaleTimeString('zh-CN', { hour12: false })}${timelineInfo?.offsetSec ? `（偏移 ${timelineInfo.offsetSec > 0 ? '+' : ''}${timelineInfo.offsetSec}s）` : ''}`
                          : '未检测到开播起点（将默认以当天第一封为 00:00:00，支持 OBS / B站自动同步或选录播文件）'}
                      </span>
                    </div>
                    <div className="wc-actions">
                      {onSyncTimeline ? (
                        <button type="button" className="wc-queue-small" onClick={() => void onSyncTimeline()}>
                          🔄 同步检测
                        </button>
                      ) : null}
                      {onSyncTimeline && timelineInfo?.streamTrack && timelineInfo?.recordTrack ? (
                        <>
                          <button
                            type="button"
                            className="wc-queue-small"
                            aria-pressed={timelineInfo.anchorSource === 'obs-ws-stream' || timelineInfo.anchorSource === 'obs-log-stream' || timelineInfo.anchorSource === 'bilibili'}
                            onClick={() => void onSyncTimeline('stream')}
                          >
                            对齐推流
                          </button>
                          <button
                            type="button"
                            className="wc-queue-small"
                            aria-pressed={timelineInfo.anchorSource === 'obs-ws-record' || timelineInfo.anchorSource === 'obs-log-record'}
                            onClick={() => void onSyncTimeline('record')}
                          >
                            对齐录制
                          </button>
                        </>
                      ) : null}
                      {onPickRecordingFile ? (
                        <button type="button" className="wc-queue-small" onClick={() => void onPickRecordingFile()}>
                          🎬 按录播文件对齐
                        </button>
                      ) : null}
                      {onSetStreamStartedAt ? (
                        <button type="button" className="wc-queue-small" onClick={() => void onSetStreamStartedAt('now')}>
                          ⏱ 标记现在开播
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {streamStartedAt || (timelineInfo && timelineInfo.offsetSec !== 0) ? (
                    <div className="wc-bb-timeline-row">
                      {streamStartedAt && onSetStreamStartedAt ? (
                        <label className="wc-bb-time-adjust">
                          <span>微调起点</span>
                          <input
                            type="time"
                            step={1}
                            aria-label="微调开播时间"
                            value={(() => {
                              const d = new Date(streamStartedAt);
                              return Number.isNaN(d.getTime())
                                ? ''
                                : [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
                            })()}
                            onChange={e => {
                              const parts = e.target.value.split(':').map(Number);
                              if (parts.length >= 2 && parts.every(Number.isFinite)) {
                                const base = new Date(streamStartedAt);
                                if (!Number.isNaN(base.getTime())) {
                                  base.setHours(parts[0]!, parts[1]!, parts[2] ?? 0, 0);
                                  void onSetStreamStartedAt(base.toISOString());
                                }
                              }
                            }}
                          />
                        </label>
                      ) : null}
                      {onSetTimelineOffset ? (
                        <div className="wc-bb-offset-control">
                          <span className="wc-muted">整体偏移</span>
                          <button
                            type="button"
                            className="wc-queue-small"
                            aria-label="偏移减 5 秒"
                            onClick={() => void onSetTimelineOffset((timelineInfo?.offsetSec ?? 0) - 5)}
                          >
                            -5s
                          </button>
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label="时间轴整体偏移秒数"
                            value={offsetFocused ? offsetDraft : String(timelineInfo?.offsetSec ?? 0)}
                            onFocus={() => {
                              setOffsetFocused(true);
                              setOffsetDraft(String(timelineInfo?.offsetSec ?? 0));
                            }}
                            onChange={e => {
                              const raw = e.target.value;
                              if (!/^-?\d*$/.test(raw)) return;
                              setOffsetDraft(raw);
                              if (raw !== '' && raw !== '-') {
                                const v = Number(raw);
                                if (Number.isFinite(v)) {
                                  const clamped = Math.max(-7200, Math.min(7200, Math.round(v)));
                                  void onSetTimelineOffset(clamped);
                                }
                              }
                            }}
                            onBlur={() => {
                              setOffsetFocused(false);
                              const trimmed = offsetDraft.trim();
                              if (trimmed === '' || trimmed === '-') {
                                setOffsetDraft(String(timelineInfo?.offsetSec ?? 0));
                                return;
                              }
                              const v = Number(trimmed);
                              if (Number.isFinite(v)) {
                                const clamped = Math.max(-7200, Math.min(7200, Math.round(v)));
                                setOffsetDraft(String(clamped));
                                if (clamped !== (timelineInfo?.offsetSec ?? 0)) {
                                  void onSetTimelineOffset(clamped);
                                }
                              } else {
                                setOffsetDraft(String(timelineInfo?.offsetSec ?? 0));
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="wc-queue-small"
                            aria-label="偏移加 5 秒"
                            onClick={() => void onSetTimelineOffset((timelineInfo?.offsetSec ?? 0) + 5)}
                          >
                            +5s
                          </button>
                          {timelineInfo?.offsetSec ? (
                            <button
                              type="button"
                              className="wc-subtle wc-queue-small"
                              onClick={() => void onSetTimelineOffset(0)}
                            >
                              归零
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {streamStartedAt && onSetStreamStartedAt ? (
                        <button
                          type="button"
                          className="wc-subtle wc-queue-small"
                          style={{ marginLeft: 'auto' }}
                          onClick={() => void onSetStreamStartedAt(null)}
                        >
                          清除标记
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {sessionHistory.length ? (
                <ul className="wc-bb-history-log" aria-label="本机播报复盘列表">
                  {(() => {
                    const startMs = streamStartedAt && Number.isFinite(Date.parse(streamStartedAt)) ? Date.parse(streamStartedAt) : null;
                    const offsetSec = timelineInfo?.offsetSec ?? 0;
                    const anchorSource = timelineInfo?.anchorSource ?? null;
                    const earliestByDay = new Map<string, number>();
                    for (const e of sessionHistory) {
                      const ms = Date.parse(e.playedAt);
                      if (!Number.isFinite(ms)) continue;
                      const prev = earliestByDay.get(e.dateKey);
                      if (prev === undefined || ms < prev) earliestByDay.set(e.dateKey, ms);
                    }
                    const fmtSec = (sec: number) => {
                      const s = Math.max(0, Math.floor(sec));
                      return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
                        .map(n => String(n).padStart(2, '0'))
                        .join(':');
                    };
                    return sessionHistory.slice(0, 30).map(item => {
                      const ms = Date.parse(item.playedAt);
                      let offsetLabel = '';
                      if (anchorSource === 'obs-ws-record' && typeof item.obsRecordMs === 'number' && Number.isFinite(item.obsRecordMs)) {
                        offsetLabel = fmtSec(Math.floor(item.obsRecordMs / 1000) + offsetSec);
                      } else if (anchorSource === 'obs-ws-stream' && typeof item.obsStreamMs === 'number' && Number.isFinite(item.obsStreamMs)) {
                        offsetLabel = fmtSec(Math.floor(item.obsStreamMs / 1000) + offsetSec);
                      } else {
                        const anchorMs = startMs !== null && ms >= startMs ? startMs : earliestByDay.get(item.dateKey) ?? ms;
                        if (Number.isFinite(ms) && Number.isFinite(anchorMs)) {
                          offsetLabel = fmtSec(Math.floor((ms - anchorMs) / 1000) + offsetSec);
                        }
                      }
                      return (
                        <li key={item.id} className="wc-bb-history-row">
                          <div className="wc-bb-history-row-head">
                            <span className="wc-bb-history-title">
                              {offsetLabel ? <code className="wc-bb-vod-ts">{offsetLabel}</code> : null}
                              <strong>{item.nickname || '匿名来信'}</strong>
                            </span>
                            <span className="wc-muted">{`${item.dateKey} ${new Date(item.playedAt).toLocaleTimeString('zh-CN', { hour12: false })}`}</span>
                          </div>
                          <span className="wc-snippet">{item.textSnippet}</span>
                        </li>
                      );
                    });
                  })()}
                </ul>
              ) : (
                <p className="wc-muted">本机还没有记录到上屏来信，开始播报后将自动按时间记录，方便下播复盘切片。</p>
              )}
            </>
          ) : null}
        </div>
      </details>
      ) : null}
    </div>
  );
}
