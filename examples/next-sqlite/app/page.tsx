'use client';

import {
  DEFAULT_POSTER_CONFIG,
  WindChimeAdminPanel,
  WindChimeBlocklistPanel,
  WindChimeFloatingButton,
  WindChimeQrCard,
  WindChimeQrPosterEditor,
} from '@windchime/embed';
import type {
  WindChimeBlockedSender,
  WindChimeInboxFilter,
  WindChimeMessageRecord,
  WindChimeQrPosterConfig,
  WindChimeSubmitPayload,
} from '@windchime/embed';
import '@windchime/embed/styles/windchime.css';
import { useCallback, useEffect, useMemo, useState } from 'react';

async function readError(res: Response): Promise<string> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await res.json()) as { error?: string };
    return j.error ?? res.statusText;
  }
  return (await res.text()) || res.statusText;
}

type ListResponse = {
  items: WindChimeMessageRecord[];
  counts: Record<WindChimeInboxFilter, number>;
};

export default function DemoPage() {
  const [items, setItems] = useState<WindChimeMessageRecord[]>([]);
  const [counts, setCounts] = useState<Record<WindChimeInboxFilter, number>>({
    all: 0,
    unread: 0,
    favorited: 0,
  });
  const [filter, setFilter] = useState<WindChimeInboxFilter>('all');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [blocklist, setBlocklist] = useState<WindChimeBlockedSender[]>([]);
  const [blLoading, setBlLoading] = useState(false);
  const [blError, setBlError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enabledSaving, setEnabledSaving] = useState(false);
  const [enabledError, setEnabledError] = useState<string | null>(null);

  const reload = useCallback(
    async (f: WindChimeInboxFilter = filter) => {
      setLoading(true);
      setListError(null);
      try {
        const r = await fetch(`/api/messages?filter=${f}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(await readError(r));
        const data = (await r.json()) as ListResponse;
        setItems(data.items);
        setCounts(data.counts);
      } catch (e) {
        setListError(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );

  const reloadBlocklist = useCallback(async () => {
    setBlLoading(true);
    setBlError(null);
    try {
      const r = await fetch('/api/blocklist', { cache: 'no-store' });
      if (!r.ok) throw new Error(await readError(r));
      setBlocklist((await r.json()) as WindChimeBlockedSender[]);
    } catch (e) {
      setBlError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setBlLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload(filter);
  }, [reload, filter]);

  useEffect(() => {
    void reloadBlocklist();
  }, [reloadBlocklist]);

  const reloadSettings = useCallback(async () => {
    setEnabledError(null);
    try {
      const r = await fetch('/api/settings', { cache: 'no-store' });
      if (!r.ok) throw new Error(await readError(r));
      const j = (await r.json()) as { enabled?: boolean };
      if (typeof j.enabled === 'boolean') setEnabled(j.enabled);
    } catch (e) {
      setEnabledError(e instanceof Error ? e.message : '读取失败');
    }
  }, []);

  const toggleEnabled = useCallback(async (next: boolean) => {
    setEnabledSaving(true);
    setEnabledError(null);
    const prev = enabled;
    setEnabled(next);
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!r.ok) throw new Error(await readError(r));
    } catch (e) {
      setEnabled(prev);
      setEnabledError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setEnabledSaving(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  const onSubmit = useCallback(async (payload: WindChimeSubmitPayload) => {
    const r = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: payload.text,
        nickname: payload.nickname,
        linkUrl: payload.linkUrl,
        senderFingerprint: payload.senderFingerprint,
      }),
    });
    if (!r.ok) throw new Error(await readError(r));
    await reload();
  }, [reload]);

  const onDelete = useCallback(
    async (id: string) => {
      const r = await fetch(`/api/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await readError(r));
      await reload();
    },
    [reload],
  );

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const r = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await readError(r));
      await reload();
    },
    [reload],
  );

  const onToggleRead = useCallback(
    (id: string, isRead: boolean) => patch(id, { isRead }),
    [patch],
  );
  const onToggleFavorite = useCallback(
    (id: string, isFavorited: boolean) => patch(id, { isFavorited }),
    [patch],
  );
  const onBlockSender = useCallback(
    async (id: string) => {
      const r = await fetch(`/api/messages/${encodeURIComponent(id)}/block`, {
        method: 'POST',
      });
      if (!r.ok) throw new Error(await readError(r));
      await Promise.all([reload(), reloadBlocklist()]);
    },
    [reload, reloadBlocklist],
  );

  const batch = useCallback(
    async (action: 'delete' | 'markRead', ids: string[]) => {
      const r = await fetch('/api/messages/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids }),
      });
      if (!r.ok) throw new Error(await readError(r));
      await reload();
    },
    [reload],
  );

  const onBatchDelete = useCallback((ids: string[]) => batch('delete', ids), [batch]);
  const onBatchMarkRead = useCallback((ids: string[]) => batch('markRead', ids), [batch]);

  const onUnblock = useCallback(
    async (hash: string) => {
      const r = await fetch(`/api/blocklist/${encodeURIComponent(hash)}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error(await readError(r));
      await reloadBlocklist();
    },
    [reloadBlocklist],
  );

  return (
    <>
      {/* 氛围背景 */}
      <div className="fixed inset-0 -z-10 overflow-hidden bg-slate-50 dark:bg-slate-950">
        <div className="absolute -top-[20%] left-[10%] h-[50%] w-[40%] rounded-full bg-violet-400/20 blur-[120px] dark:bg-violet-900/30" />
        <div className="absolute bottom-[10%] right-[10%] h-[40%] w-[30%] rounded-full bg-fuchsia-400/20 blur-[120px] dark:bg-fuchsia-900/30" />
        <div className="absolute left-[30%] top-[30%] h-[30%] w-[30%] rounded-full bg-emerald-400/10 blur-[100px] dark:bg-emerald-900/20" />
      </div>

      <main className="relative mx-auto flex max-w-[1400px] flex-col gap-16 px-4 py-12 sm:px-8">
        <header className="text-center">
          <h1 className="bg-gradient-to-br from-violet-600 to-fuchsia-600 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent dark:from-violet-300 dark:to-fuchsia-300">
            WindChime Demo
          </h1>
          <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
            留言写入 <code className="rounded-md border border-slate-200/60 bg-white/60 px-1.5 py-0.5 text-xs shadow-sm dark:border-white/10 dark:bg-slate-800/60">data/windchime.db</code>
            ，接口见 <code className="rounded-md border border-slate-200/60 bg-white/60 px-1.5 py-0.5 text-xs shadow-sm dark:border-white/10 dark:bg-slate-800/60">app/api</code>
          </p>
        </header>

      <section className="flex flex-col items-stretch gap-8 lg:flex-row lg:items-start">
        <div className="flex-1 lg:max-w-lg">
          <EnableToggleCard
            enabled={enabled}
            saving={enabledSaving}
            error={enabledError}
            onToggle={toggleEnabled}
          />
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            留言入口在左下角的🎐浮动按钮，点开弹窗就能写信。关闭风铃时按钮会变灰。
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <WindChimeAdminPanel
            items={items}
            counts={counts}
            filter={filter}
            onFilterChange={setFilter}
            autoClientFilter={false}
            isLoading={loading}
            error={listError}
            onReload={() => void reload()}
            onDelete={onDelete}
            onToggleRead={onToggleRead}
            onToggleFavorite={onToggleFavorite}
            onBlockSender={onBlockSender}
            onBatchDelete={onBatchDelete}
            onBatchMarkRead={onBatchMarkRead}
          />
        </div>
      </section>

      <section>
        <WindChimeBlocklistPanel
          items={blocklist}
          isLoading={blLoading}
          error={blError}
          onReload={() => void reloadBlocklist()}
          onUnblock={onUnblock}
        />
      </section>

      <ShareToolsSection />
    </main>

    <WindChimeFloatingButton
      onSubmit={onSubmit}
      settingsUrl="/api/settings"
      senderProps={{ collectNickname: true, collectLinkUrl: true, rateLimit: false }}
    />
    </>
  );
}

function EnableToggleCard(props: {
  enabled: boolean | null;
  saving: boolean;
  error: string | null;
  onToggle: (next: boolean) => void;
}) {
  const { enabled, saving, error, onToggle } = props;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/60 bg-white/60 p-5 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/40">
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden>
          🎐
        </span>
        <div>
          <div className="text-sm font-bold text-slate-800 dark:text-slate-100">风铃开关</div>
          <div className="text-xs text-slate-500">
            {enabled === null
              ? '读取中…'
              : enabled
                ? '当前开启，游客可正常投递留言。'
                : '已关闭，浮动按钮会变灰且禁止发送。'}
          </div>
          {error && <div className="mt-1 text-xs text-rose-600">{error}</div>}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!enabled}
        disabled={enabled === null || saving}
        onClick={() => onToggle(!enabled)}
        className={
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60 ' +
          (enabled
            ? 'border-violet-400 bg-gradient-to-r from-violet-500 to-fuchsia-500'
            : 'border-slate-300 bg-slate-300 dark:bg-slate-700')
        }
      >
        <span
          className={
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition ' +
            (enabled ? 'translate-x-6' : 'translate-x-1')
          }
        />
      </button>
    </div>
  );
}

/** 分享工具：二维码海报 + 海报编辑器 */
function ShareToolsSection() {
  const pageUrl = useMemo(
    () => (typeof window !== 'undefined' ? window.location.origin + '/' : 'https://example.com/'),
    [],
  );

  const [poster, setPoster] = useState<WindChimeQrPosterConfig>(() => ({
    ...DEFAULT_POSTER_CONFIG,
    heading: '扫码给我留言',
    body: '把你想说的话，挂在风铃上吧 ~ 匿名也可以哦。',
  }));

  return (
    <section className="flex flex-col gap-6">
      <h2 className="bg-gradient-to-br from-violet-600 to-fuchsia-600 bg-clip-text text-2xl font-bold tracking-tight text-transparent dark:from-violet-300 dark:to-fuchsia-300">
        分享工具
      </h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <WindChimeQrCard
          url={pageUrl}
          title="扫码给我挂风铃"
          subtitle={pageUrl}
          foreground="#6d28d9"
          poster={{
            enabled: true,
            heading: poster.heading,
            body: poster.body,
            footer: poster.footer || pageUrl,
            avatarSrc: poster.avatarSrc || undefined,
          }}
        />
        <WindChimeQrPosterEditor
          value={poster}
          onChange={setPoster}
          storageKey="windchime-demo:poster"
        />
      </div>
    </section>
  );
}
