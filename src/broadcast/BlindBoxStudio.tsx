'use client';
import { useEffect, useRef, useState } from 'react';
import type { WindChimeLiveClient } from '../client/live.js';
import type { WindChimeLiveDraft, WindChimeLiveMessage } from '../core/live.js';
import type { useWindChimeLiveControl } from '../react/live.js';
import { OnAirTeleprompter } from './Teleprompter.js';
import type {
  WindChimeDisplayScrollCommand,
  WindChimeDisplayScrollMetrics,
} from './scroll-loop.js';

type Studio = ReturnType<typeof useWindChimeLiveControl>;

export type BlindBoxStudioProps = {
  client: WindChimeLiveClient;
  topicId: string;
  studio: Studio;
  blockedTermsEnabled?: boolean;
  scrollState?: WindChimeDisplayScrollMetrics | null;
  onScrollDisplay?: (command: WindChimeDisplayScrollCommand) => Promise<void> | void;
  onOpenDisplay?: () => Promise<void>;
  onHideDisplay?: () => Promise<void>;
  testCardActive?: boolean;
  onToggleTestCard?: (active: boolean) => Promise<void>;
  randomDrawEnabled?: boolean;
  clearOnBlindDraw?: boolean;
  onToggleClearOnBlindDraw?: (enabled: boolean) => void;
  onBlockMessage?: (messageId: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  playedIds: string[];
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
  onBlockMessage?: (messageId: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onDone: () => void;
  onPutBack: () => void;
}) {
  const [draft, setDraft] = useState<WindChimeLiveDraft>(() => structuredClone(message.draft));
  const [editing, setEditing] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [localError, setLocalError] = useState('');
  const [blocking, setBlocking] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(message.draft);
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
      const entries = results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
      setAssetUrls(Object.fromEntries(entries));
    });
    return release;
  }, [client, topicId, message.id, assetSig]);

  const persistAndApprove = async () => {
    setLocalError('');
    if (!draft.text.trim()) {
      setLocalError('展示正文不能为空');
      return null;
    }
    let approveDraftRev = message.draftRevision;
    if (dirty) {
      const savedState = await studio.actWithResult({
        action: 'draft',
        messageId: message.id,
        expectedDraftRevision: message.draftRevision,
        draft: structuredClone(draft),
      });
      if (!savedState) return null;
      const saved = savedState.messages.find(item => item.id === message.id);
      if (!saved) return null;
      approveDraftRev = saved.draftRevision;
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
    const shown = await studio.actWithResult({ action: 'show', messageId: message.id });
    if (shown) onDone();
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
      expectedDraftRevision: message.draftRevision,
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
      await onBlockMessage(message.id);
      onDirtyChange?.(false);
      onDone();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : '屏蔽失败');
    } finally {
      setBlocking(false);
    }
  };

  const busy = studio.pending || blocking;
  const assetsMissing = draft.assets.some(a => !assetUrls[a.id]);
  const removedSomeImages = message.draft.assets.some(a => !draft.assets.some(d => d.id === a.id));

  return (
    <section className="wc-panel wc-bb-unbox" aria-label="私下拆封预览">
      <div className="wc-bb-private-banner" role="status">
        <strong>仅主播可见 · 尚未上屏</strong>
        <span>先扫一眼确认内容安全，点击「确认并直接上屏」才会展示给观众</span>
      </div>

      <div className="wc-pad wc-stack">
        <div className="wc-bb-letter-head">
          <div>
            <h3>{draft.nickname || '匿名来信'}</h3>
            <span className="wc-muted">{new Date(message.createdAt).toLocaleString('zh-CN')}</span>
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
            {dirty ? (
              <div className="wc-actions">
                <button
                  type="button"
                  className="wc-subtle"
                  onClick={() => setDraft(structuredClone(message.draft))}
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
              {removedSomeImages ? (
                <button
                  type="button"
                  className="wc-queue-small"
                  onClick={() => setDraft({ ...draft, assets: structuredClone(message.draft.assets) })}
                >
                  恢复全部附图
                </button>
              ) : null}
            </div>
            <div className="wc-bb-asset-grid">
              {draft.assets.map((asset, index) => {
                const isRevealed = Boolean(revealed[asset.id]);
                const url = assetUrls[asset.id];
                return (
                  <div key={asset.id} className="wc-bb-asset-card">
                    <div className="wc-bb-asset-frame">
                      {url ? (
                        <img
                          src={url}
                          alt={asset.caption || `附图 ${index + 1}`}
                          className={isRevealed ? '' : 'is-blurred'}
                        />
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
                    <div className="wc-actions">
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
        ) : removedSomeImages ? (
          <div className="wc-actions">
            <span className="wc-muted">已移除全部附图，本次将仅展示文字。</span>
            <button
              type="button"
              className="wc-queue-small"
              onClick={() => setDraft({ ...draft, assets: structuredClone(message.draft.assets) })}
            >
              恢复附图
            </button>
          </div>
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
            disabled={busy || !studio.connected || receivers === 0 || !draft.text.trim() || assetsMissing}
            onClick={() => void approveAndShow()}
          >
            {dirty ? '✓ 保存并直接上屏' : '✓ 确认并直接上屏'}
          </button>
          <button
            type="button"
            disabled={busy || !studio.connected || !draft.text.trim() || assetsMissing}
            onClick={() => void approveOnly()}
          >
            仅加入待播
          </button>
          <button
            type="button"
            disabled={busy || !studio.connected}
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
    blockedTermsEnabled = false,
    scrollState,
    onScrollDisplay,
    onOpenDisplay,
    onHideDisplay,
    testCardActive = false,
    onToggleTestCard,
    randomDrawEnabled = false,
    clearOnBlindDraw = false,
    onToggleClearOnBlindDraw,
    onBlockMessage,
    onDirtyChange,
    playedIds,
    onEndShow,
    onPrevLetter,
    canPrev,
    autoMarkRead,
    onToggleAutoMarkRead,
  } = props;

  const [unboxedId, setUnboxedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [unboxDirty, setUnboxDirty] = useState(false);
  const drawnPoolRef = useRef(new Set<string>());

  useEffect(() => {
    setUnboxedId(null);
    setUnboxDirty(false);
    drawnPoolRef.current.clear();
  }, [topicId]);

  useEffect(() => {
    onDirtyChange?.(unboxDirty);
  }, [unboxDirty, onDirtyChange]);

  const state = studio.state;
  const allMessages = state?.messages ?? [];
  const pending = allMessages.filter(m => m.status === 'pending');
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

  const drawLetter = async (random: boolean) => {
    if (!pending.length) return;
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
    const candidates = pending.length > 1 ? pending.filter(m => m.id !== unboxedId) : pending;
    const chosen = random
      ? candidates[Math.floor(Math.random() * candidates.length)]!
      : candidates[0]!;
    drawnPoolRef.current.add(chosen.id);
    setUnboxedId(chosen.id);
  };

  return (
    <div className="wc-bb-studio" aria-label="盲盒拆信台">
      <div className="wc-panel wc-bb-topbar">
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

      {actionError ? <p className="wc-error" role="alert">{actionError}</p> : null}

      {unboxed ? (
        <BlindBoxUnboxCard
          key={`${topicId}:${unboxed.id}`}
          client={client}
          topicId={topicId}
          message={unboxed}
          studio={studio}
          blockedTermsEnabled={blockedTermsEnabled}
          receivers={state?.receivers ?? 0}
          onOpenDisplay={safeOpenDisplay}
          onToggleTestCard={safeToggleTestCard}
          testCardActive={testCardActive}
          onBlockMessage={onBlockMessage}
          onDirtyChange={setUnboxDirty}
          onDone={() => setUnboxedId(null)}
          onPutBack={() => setUnboxedId(null)}
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
                disabled={!studio.connected || studio.pending || !pending.length}
                onClick={() => void drawLetter(false)}
              >
                {pending.length ? `拆下一封 ✉（剩 ${pending.length}）` : '暂无更多未拆来信'}
              </button>
              {randomDrawEnabled ? (
                <button
                  type="button"
                  disabled={!studio.connected || studio.pending || !pending.length}
                  onClick={() => void drawLetter(true)}
                >
                  随机拆一封
                </button>
              ) : null}
              {unplayedQueue.length > 0 ? (
                <button
                  type="button"
                  disabled={!studio.connected || !state?.receivers || studio.pending}
                  onClick={() => void studio.act({ action: 'next' })}
                >
                  下一封已批准 →
                </button>
              ) : null}
              <button
                type="button"
                disabled={!studio.connected || !state?.receivers || studio.pending || !canPrev}
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
            <div className="wc-bb-badge-count">{pending.length}</div>
            <h3>
              {!state
                ? '正在连接信箱…'
                : pending.length > 0
                  ? `还有 ${pending.length} 封未拆来信`
                  : queue.length > 0
                    ? `全部新来信已拆完 · 待播列表有 ${queue.length} 封`
                    : '暂时还没有新来信'}
            </h3>
            <p className="wc-muted">
              点击「拆下一封」只会在你的私人屏幕上拆封，保留初见惊喜感且绝不会提前泄露给观众；确认无雷后再一键上屏。
            </p>
            {state && state.receivers === 0 ? (
              <div className="wc-display-guide" role="status" style={{ maxWidth: 540, width: '100%' }}>
                <span>展示窗口尚未打开，建议先打开并在 OBS 中对好位置。</span>
                <div className="wc-actions">
                  {safeOpenDisplay ? (
                    <button type="button" className="wc-primary" onClick={safeOpenDisplay}>
                      打开独立展示窗口
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
              <button
                type="button"
                className="wc-primary wc-bb-draw-btn"
                disabled={!studio.connected || studio.pending || !pending.length}
                onClick={() => void drawLetter(false)}
              >
                拆下一封 ✉
              </button>
              {randomDrawEnabled ? (
                <button
                  type="button"
                  disabled={!studio.connected || studio.pending || !pending.length}
                  onClick={() => void drawLetter(true)}
                >
                  随机拆一封
                </button>
              ) : null}
              {queue.length > 0 ? (
                <button
                  type="button"
                  disabled={!studio.connected || !state?.receivers || studio.pending}
                  onClick={() => void studio.act({ action: 'next' })}
                >
                  播待播列表下一封 →
                </button>
              ) : null}
            </div>
          </div>
        </section>
      )}

      <details className="wc-panel wc-bb-history">
        <summary>
          <span>{`待播与本场已播记录（${queue.length} 封）`}</span>
          <span className="wc-muted">展开可重新上屏、撤销批准或重置本场进度</span>
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
                      disabled={studio.pending || !studio.connected || !state?.receivers}
                      onClick={() => void studio.act({ action: 'show', messageId: m.id })}
                    >
                      上屏
                    </button>
                    <button
                      type="button"
                      className="wc-queue-small"
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
        </div>
      </details>
    </div>
  );
}
