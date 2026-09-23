import { useCallback, useEffect, useRef, useState } from "react";
import type { WindChimeClient } from "../../../src/client";
import type {
  WindChimeAdminTopic,
  WindChimeBlockedSender,
  WindChimeInboxFilter,
  WindChimeMessageList,
  WindChimeMessageRecord,
} from "../../../src/core";
import type { WindChimeLiveControlState } from "../../../src/core/live";
import { windChimeTopicStateLabel } from "../../../src/types-topics";
import {
  renderWindChimeQr,
  renderWindChimePoster,
  windChimeCanvasToBlob,
  readWindChimePosterConfig,
  writeWindChimePosterConfig,
} from "../../../src/media";
import { unwrap } from "./bridge";
const bridge = window.windchimeDesktop;
type Common = {
  client: WindChimeClient;
  topicId: string;
  siteScope: boolean;
  keywordEnabled: boolean;
  onError(message: string): void;
  onDirtyChange?(dirty: boolean): void;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "请求失败，请检查网站版本和连接状态";
async function confirm(text: string) {
  return unwrap(bridge.confirm(text));
}
export function Inbox({
  client,
  topicId,
  siteScope,
  keywordEnabled,
  onError,
}: Common) {
  const [filter, setFilter] = useState<WindChimeInboxFilter>("all"),
    [data, setData] = useState<WindChimeMessageList>({
      items: [],
      counts: { all: 0, unread: 0, favorited: 0, flagged: 0 },
    });
  const [active, setActive] = useState<string | null>(null),
    [checked, setChecked] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState("");
  const [images, setImages] = useState<Array<{ url: string; caption: string }>>(
    [],
  );
  const [detail, setDetail] = useState<WindChimeMessageRecord | null>(null);
  const generation = useRef(0);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++generation.current;
      const next = await client.messages.list({ topicId, filter, signal });
      const opened = active
        ? await client.messages
            .detail(active, { topicId, signal })
            .catch((error) => {
              if (error.status === 404) return null;
              throw error;
            })
        : null;
      if (version === generation.current && !signal?.aborted) {
        setData(next);
        setDetail(opened);
        setChecked((current) =>
          current.filter((id) => next.items.some((item) => item.id === id)),
        );
      }
    },
    [client, topicId, filter, active],
  );
  useEffect(() => {
    if (!keywordEnabled && filter === "flagged") setFilter("all");
  }, [keywordEnabled, filter]);
  useEffect(() => {
    setDetail(null);
    if (!active) return;
    const abort = new AbortController();
    void client.messages
      .detail(active, { topicId, signal: abort.signal })
      .then((item) => {
        if (!abort.signal.aborted) setDetail(item);
      })
      .catch((e) => {
        if (!abort.signal.aborted) onError(message(e));
      });
    return () => abort.abort();
  }, [active, client, topicId, onError]);
  useEffect(() => {
    const abort = new AbortController(),
      owned: string[] = [];
    setImages([]);
    if (active)
      void client
        .request<WindChimeLiveControlState>("/state", "GET", undefined, {
          topicId,
          signal: abort.signal,
        })
        .then(async (state) => {
          const assets =
            state.messages.find((item) => item.id === active)?.source.assets ??
            [];
          const rows = await Promise.all(
            assets.map(async (asset) => {
              const result = await client.request<{
                image: string;
                mimeType: string;
              }>(`/assets/${encodeURIComponent(asset.id)}`, "GET", undefined, {
                topicId,
                signal: abort.signal,
              });
              if (abort.signal.aborted) return null;
              if (
                !["image/png", "image/jpeg", "image/webp"].includes(
                  result.mimeType,
                )
              )
                throw new Error("无效图片格式");
              const blob = new Blob(
                  [Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0))],
                  { type: result.mimeType },
                ),
                url = URL.createObjectURL(blob);
              owned.push(url);
              return { url, caption: asset.caption };
            }),
          );
          if (!abort.signal.aborted)
            setImages(
              rows.filter(
                (item): item is { url: string; caption: string } => !!item,
              ),
            );
        })
        .catch((e) => {
          if (!abort.signal.aborted) onError(message(e));
        });
    return () => {
      abort.abort();
      owned.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [active, client, topicId, onError]);
  useEffect(() => {
    const abort = new AbortController();
    let polling = false, refreshAgain = false;
    const wake = () => {
      if (!busy && !polling && !abort.signal.aborted && document.visibilityState !== "hidden") {
        polling = true;
        void load(abort.signal).catch((e) => {
          if (!abort.signal.aborted) onError(message(e));
        }).finally(() => {
          polling = false;
          if (refreshAgain) { refreshAgain = false; wake(); }
        });
      }
    };
    wake();
    const timer = setInterval(wake, 3000);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    const unsubscribe = client.subscribe(() => { if (polling) refreshAgain = true; else wake(); });
    return () => {
      abort.abort();
      generation.current++;
      clearInterval(timer);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
      unsubscribe();
    };
  }, [load, busy, onError]);
  const act = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
      await load();
    } catch (e) {
      onError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const rows = data.items.filter((item) =>
    [item.text, item.nickname, item.senderLabel].some((value) =>
      value?.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ),
  );
  const listed = data.items.find((item) => item.id === active);
  const item =
    detail?.id === active
      ? {
          ...detail,
          ...(listed
            ? {
                isRead: listed.isRead,
                isFavorited: listed.isFavorited,
                isFlagged: listed.isFlagged,
              }
            : {}),
        }
      : listed;
  const open = (item: WindChimeMessageRecord) => {
    setActive(item.id);
    if (!item.isRead)
      void act(() =>
        client.messages.update(item.id, { isRead: true }, { topicId }),
      );
  };
  const exportCsv = () =>
    void act(async () => {
      const items = checked.length
        ? data.items.filter((row) => checked.includes(row.id))
        : rows;
      await unwrap(
        bridge.saveFile({
          kind: "csv",
          name: "风铃来信.csv",
          content: client.exportCsv(items),
        }),
      );
    });
  return (
    <section className="management wc-live" aria-label="收件箱管理">
      <div className="management-toolbar">
        <div className="management-filters">
          {(
            [
              "all",
              "unread",
              "favorited",
              ...(keywordEnabled ? ["flagged"] : []),
            ] as WindChimeInboxFilter[]
          ).map((key) => (
            <button
              key={key}
              aria-pressed={filter === key}
              onClick={() => {
                setFilter(key);
                setActive(null);
                setChecked([]);
              }}
            >
              {
                {
                  all: "全部",
                  unread: "未读",
                  favorited: "收藏",
                  flagged: "敏感词待审",
                }[key]
              }{" "}
              <b>{data.counts[key]}</b>
            </button>
          ))}
        </div>
        <input
          aria-label="搜索来信"
          placeholder="搜索正文、昵称或发送者标签"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="management-toolbar">
        <label>
          <input
            type="checkbox"
            checked={
              rows.length > 0 && rows.every((row) => checked.includes(row.id))
            }
            onChange={(e) =>
              setChecked(e.target.checked ? rows.map((row) => row.id) : [])
            }
          />{" "}
          选择当前列表
        </label>
        <span>已选 {checked.length} 封</span>
        <button
          disabled={busy || !checked.length}
          onClick={() =>
            void act(() =>
              client.messages.batch("markRead", checked, { topicId }),
            )
          }
        >
          批量标为已读
        </button>
        <button
          disabled={busy || !checked.length}
          onClick={() =>
            void act(async () => {
              if (
                await confirm(
                  `删除已选的 ${checked.length} 封来信？对应待播和正在展示的内容会同步撤下。`,
                )
              )
                await client.messages.batch("delete", checked, { topicId });
            })
          }
        >
          批量删除
        </button>
        <button disabled={busy || !rows.length} onClick={exportCsv}>
          导出 {checked.length ? "所选" : "当前列表"} CSV
        </button>
      </div>
      <div className="mailbox-columns">
        <div className="glass-surface management-list">
          {!rows.length ? (
            <p className="empty-copy">这里暂时没有来信。</p>
          ) : (
            rows.map((row) => (
              <div
                className={`inbox-row ${active === row.id ? "is-current" : ""}`}
                key={row.id}
              >
                <input
                  aria-label={`选择 ${row.nickname || "匿名"} 的来信`}
                  type="checkbox"
                  checked={checked.includes(row.id)}
                  onChange={(e) =>
                    setChecked((current) =>
                      e.target.checked
                        ? [...current, row.id]
                        : current.filter((id) => id !== row.id),
                    )
                  }
                />
                <button onClick={() => open(row)}>
                  <span>
                    <strong>{row.nickname || "匿名来信"}</strong>
                    {!row.isRead && <i className="unread-dot" />}
                    {row.isFavorited && <span>★</span>}
                  </span>
                  <p>{row.text}</p>
                  <small>
                    {row.senderLabel || "匿名发送者"} ·{" "}
                    {new Date(row.createdAt).toLocaleString("zh-CN")}
                    {keywordEnabled && row.isFlagged ? " · 敏感词待审" : ""}
                  </small>
                </button>
              </div>
            ))
          )}
        </div>
        <article className="glass-surface management-detail">
          {item ? (
            <>
              <h2>{item.nickname || "匿名来信"}</h2>
              <p className="wc-muted">
                {item.senderLabel || "匿名发送者"} ·{" "}
                {new Date(item.createdAt).toLocaleString("zh-CN")}
              </p>
              <div className="original-mail">{item.text}</div>
              {images.map((image) => (
                <figure className="original-image" key={image.url}>
                  <img src={image.url} alt={image.caption || "投稿原图"} />
                  {image.caption && <figcaption>{image.caption}</figcaption>}
                </figure>
              ))}
              {item.linkUrl && (
                <p className="original-link">外链文字：{item.linkUrl}</p>
              )}
              <div className="wc-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      client.messages.update(
                        item.id,
                        { isRead: !item.isRead },
                        { topicId },
                      ),
                    )
                  }
                >
                  {item.isRead ? "标为未读" : "标为已读"}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      client.messages.update(
                        item.id,
                        { isFavorited: !item.isFavorited },
                        { topicId },
                      ),
                    )
                  }
                >
                  {item.isFavorited ? "取消收藏" : "收藏"}
                </button>
                {keywordEnabled && item.isFlagged && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        client.messages.update(
                          item.id,
                          { isFlagged: false },
                          { topicId },
                        ),
                      )
                    }
                  >
                    清除敏感词标记
                  </button>
                )}
                <button
                  className="wc-danger"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      if (
                        await confirm(
                          "删除这封来信？它的待播和当前展示会同步撤下。",
                        )
                      )
                        await client.messages.delete(item.id, { topicId });
                    })
                  }
                >
                  删除来信
                </button>
                {siteScope && (
                  <button
                    className="wc-danger"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        if (
                          await confirm(
                            "在整个网站屏蔽此发送者并处理其来信？对应展示会同步撤下。",
                          )
                        )
                          await client.messages.block(item.id, { topicId });
                      })
                    }
                  >
                    屏蔽发送者
                  </button>
                )}
              </div>
              <p className="wc-muted">
                已读、收藏和清除敏感词标记均不代表批准播出。请在「直播工作台」审稿并手动上屏。
              </p>
            </>
          ) : (
            <p className="empty-copy">选择信件查看原文。</p>
          )}
        </article>
      </div>
    </section>
  );
}
type TopicForm = {
  title: string;
  slug: string;
  description: string;
  note: string;
  startsAt: string;
  endsAt: string;
  isEnabled: boolean;
  sortOrder: number;
};
const freshTopic = (): TopicForm => ({
  title: "",
  slug: "",
  description: "",
  note: "",
  startsAt: "",
  endsAt: "",
  isEnabled: true,
  sortOrder: 0,
});
const localDate = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function Topics({
  client,
  siteScope,
  onError,
  onDirtyChange,
  topics,
  onRefresh,
}: {
  client: WindChimeClient;
  siteScope: boolean;
  onError(message: string): void;
  onDirtyChange?(dirty: boolean): void;
  topics: WindChimeAdminTopic[];
  onRefresh(): Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null),
    [form, setForm] = useState<TopicForm>(freshTopic),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [archived, setArchived] = useState(false);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const act = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
      await onRefresh();
    } catch (e) {
      onError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const edit = async (topic?: WindChimeAdminTopic) => {
    if (dirty && !(await confirm("话题编辑尚未保存，放弃修改并打开其他话题？")))
      return;
    setEditing(topic?.id ?? "new");
    setForm(
      topic
        ? {
            title: topic.title,
            slug: topic.slug,
            description: topic.description ?? "",
            note: topic.note ?? "",
            startsAt: localDate(topic.startsAt),
            endsAt: localDate(topic.endsAt),
            isEnabled: topic.isEnabled,
            sortOrder: topic.sortOrder,
          }
        : freshTopic(),
    );
    setDirty(false);
  };
  const field = <K extends keyof TopicForm>(key: K, value: TopicForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };
  const save = () =>
    void act(async () => {
      const { slug, ...patch } = {
        ...form,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      };
      if (editing === "new") await client.topics.create({ ...patch, slug });
      else if (editing) await client.topics.update(editing, patch);
      setDirty(false);
      setEditing(null);
    });
  return (
    <section className="management wc-live" aria-label="话题管理">
      <div className="management-toolbar">
        <h2>活动与话题</h2>
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{" "}
          查看已归档
        </label>
        {siteScope && (
          <button
            className="wc-primary"
            disabled={busy}
            onClick={() => void edit()}
          >
            新建话题
          </button>
        )}
      </div>
      {!siteScope && (
        <p className="wc-notice">
          此连接是旧版话题密钥，只能查看授权话题。网站管理员可生成站点密钥以管理全部活动。
        </p>
      )}
      <div className="topic-grid">
        {topics
          .filter((topic) =>
            archived ? !!topic.archivedAt : !topic.archivedAt,
          )
          .map((topic) => (
            <article className="glass-surface topic-card" key={topic.id}>
              <div className="topic-card-title">
                <h3>{topic.title}</h3>
                <span className="wc-pill">
                  {windChimeTopicStateLabel(topic.state)}
                </span>
              </div>
              <p>{topic.description || "尚未填写说明"}</p>
              <p className="wc-muted">
                {topic.isEnabledNow ? "正在接收来信" : "当前停止接收"} · 未读{" "}
                {topic.unreadCount ?? 0}
              </p>
              <p className="wc-muted">
                {topic.startsAt
                  ? new Date(topic.startsAt).toLocaleString("zh-CN")
                  : "立即开始"}{" "}
                —{" "}
                {topic.endsAt
                  ? new Date(topic.endsAt).toLocaleString("zh-CN")
                  : "长期开放"}
              </p>
              {topic.note && (
                <p className="topic-note">私人备注：{topic.note}</p>
              )}
              {siteScope && (
                <div className="wc-actions">
                  <button disabled={busy} onClick={() => void edit(topic)}>
                    编辑
                  </button>
                  {topic.archivedAt ? (
                    <>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(() => client.topics.restore(topic.id))
                        }
                      >
                        恢复活动
                      </button>
                      <button
                        className="wc-danger"
                        disabled={busy || topic.isDefault}
                        onClick={() =>
                          void act(async () => {
                            if (
                              await confirm(
                                `永久删除「${topic.title}」及其中全部信件和图片？此操作无法撤销。`,
                              )
                            )
                              await client.topics.purge(topic.id);
                          })
                        }
                      >
                        永久删除
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(() =>
                            client.topics.update(topic.id, {
                              isEnabled: !topic.isEnabled,
                            }),
                          )
                        }
                      >
                        {topic.isEnabled ? "暂停投稿" : "开启投稿"}
                      </button>
                      <button
                        disabled={busy || topic.isDefault}
                        onClick={() =>
                          void act(async () => {
                            if (
                              await confirm(
                                `归档「${topic.title}」？它会停止投稿并撤下展示，保留原有来信。`,
                              )
                            )
                              await client.topics.archive(topic.id);
                          })
                        }
                      >
                        归档
                      </button>
                      <button
                        disabled={busy || topic.isDefault}
                        onClick={() =>
                          void act(async () => {
                            if (
                              await confirm(
                                `把「${topic.title}」全部标为已读并归档？网站将一次性完成这两个操作。`,
                              )
                            )
                              await client.topics.archive(topic.id, {
                                markReadFirst: true,
                              });
                          })
                        }
                      >
                        全部已读并归档
                      </button>
                    </>
                  )}
                </div>
              )}
            </article>
          ))}
      </div>
      {editing && (
        <form
          className="glass-surface topic-editor"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <fieldset disabled={busy}>
            <h2>
              {editing === "new" ? "新建话题" : "编辑话题"}
              {dirty ? " · 未保存" : ""}
            </h2>
            <div className="wc-grid2">
              <label>
                话题名称
                <input
                  required
                  maxLength={80}
                  value={form.title}
                  onChange={(e) => field("title", e.target.value)}
                />
              </label>
              <label>
                链接短名
                <input
                  required
                  disabled={editing !== "new"}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={form.slug}
                  onChange={(e) => field("slug", e.target.value)}
                />
              </label>
              <label>
                开始时间
                <input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) => field("startsAt", e.target.value)}
                />
              </label>
              <label>
                结束时间
                <input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) => field("endsAt", e.target.value)}
                />
              </label>
            </div>
            <label>
              公开说明
              <textarea
                value={form.description}
                maxLength={2000}
                onChange={(e) => field("description", e.target.value)}
              />
            </label>
            <label>
              私人备注
              <textarea
                value={form.note}
                maxLength={2000}
                onChange={(e) => field("note", e.target.value)}
              />
            </label>
            <div className="wc-actions">
              <label>
                <input
                  type="checkbox"
                  checked={form.isEnabled}
                  onChange={(e) => field("isEnabled", e.target.checked)}
                />{" "}
                允许投稿
              </label>
              <label>
                排列序号
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => field("sortOrder", Number(e.target.value))}
                />
              </label>
              <button
                className="wc-primary"
                disabled={busy || !dirty}
                type="submit"
              >
                保存话题
              </button>
              <button
                type="button"
                onClick={() =>
                  void (async () => {
                    if (!dirty || (await confirm("放弃未保存的话题修改？"))) {
                      setDirty(false);
                      setEditing(null);
                    }
                  })()
                }
              >
                取消
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
export function GlobalSettings({
  client,
  siteScope,
  keywordEnabled,
  onKeywordChange,
  onError,
  onDirtyChange,
}: {
  client: WindChimeClient;
  siteScope: boolean;
  keywordEnabled: boolean;
  onKeywordChange(enabled: boolean): void;
  onError(message: string): void;
  onDirtyChange?(dirty: boolean): void;
}) {
  const [terms, setTerms] = useState(""),
    [savedTerms, setSavedTerms] = useState(""),
    [blocked, setBlocked] = useState<WindChimeBlockedSender[]>([]),
    [busy, setBusy] = useState(false),
    [enabled, setEnabled] = useState(true);
  const [grants, setGrants] = useState<
    Array<{
      id: string;
      kind: string;
      scope?: string;
      label: string;
      expiresAt: string;
      revokedAt: string | null;
    }>
  >([]);
  const dirty = terms !== savedTerms;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const [termsReady, setTermsReady] = useState(false);
  const resourceVersion = useRef(0);
  const resourceController = useRef<AbortController | null>(null);
  const resourceMounted = useRef(true);
  const mutationPending = useRef(false);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const refreshResources = useCallback(async (background = false) => {
    if (!siteScope || !resourceMounted.current || mutationPending.current)
      return;
    if (background && resourceController.current && !resourceController.current.signal.aborted) return;
    resourceController.current?.abort();
    const abort = new AbortController(),
      version = ++resourceVersion.current;
    resourceController.current = abort;
    const current = () =>
      resourceMounted.current &&
      !abort.signal.aborted &&
      version === resourceVersion.current;
    try {
      const [nextBlocked, settings, nextGrants] = await Promise.all([
        client.blocklist.list({ signal: abort.signal }),
        client.request<{ enabled: boolean; blockedTermsEnabled: boolean }>(
          "/settings",
          "GET",
          undefined,
          { signal: abort.signal },
        ),
        client.request<{ items: typeof grants }>("/grants", "GET", undefined, {
          signal: abort.signal,
        }),
      ]);
      if (!current()) return;
      setBlocked(nextBlocked);
      setEnabled(settings.enabled);
      setGrants(nextGrants.items);
      onKeywordChange(settings.blockedTermsEnabled);
      if (settings.blockedTermsEnabled && !dirtyRef.current) {
        const result = await client.blockedTerms.get({ signal: abort.signal });
        if (!current()) return;
        // A local edit may have started while the remote read was in flight.
        // Keep both its text and saved baseline until the user saves/discards.
        if (!dirtyRef.current) {
          setTerms(result.terms.join("\n"));
          setSavedTerms(result.terms.join("\n"));
        }
        setTermsReady(true);
      }
    } catch (error) {
      if (current()) onError(message(error));
    } finally {
      if (resourceController.current === abort) resourceController.current = null;
    }
  }, [client, siteScope, onError, onKeywordChange]);
  useEffect(() => {
    resourceMounted.current = true;
    const resume = () => {
      if (document.visibilityState !== "hidden") void refreshResources(true);
    };
    const unsubscribe = client.subscribe((resources) => {
      if (
        resources.some((resource) =>
          ["settings", "blockedTerms", "blocklist"].includes(resource),
        )
      )
        void refreshResources();
    });
    const timer = siteScope ? setInterval(resume, 3000) : undefined;
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    resume();
    return () => {
      resourceMounted.current = false;
      ++resourceVersion.current;
      resourceController.current?.abort();
      if (timer) clearInterval(timer);
      unsubscribe();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [client, siteScope, refreshResources]);
  const act = async (task: () => Promise<unknown>) => {
    if (mutationPending.current) return;
    mutationPending.current = true;
    // Invalidate reads before issuing a write, even if the transport ignores abort.
    ++resourceVersion.current;
    resourceController.current?.abort();
    setBusy(true);
    try {
      await task();
    } catch (e) {
      onError(message(e));
    } finally {
      mutationPending.current = false;
      setBusy(false);
      await refreshResources();
    }
  };
  if (!siteScope)
    return (
      <p className="wc-notice">
        当前为话题授权。站点级屏蔽、敏感词设置和授权管理需要网站生成的站点密钥。
      </p>
    );
  return (
    <section className="management wc-live" aria-label="网站设置">
      <div className="settings-grid">
        <article className="glass-surface settings-card">
          <h2>投稿与审核设置</h2>
          <label className="setting-toggle">
            <span>
              <strong>常规信箱允许投稿</strong>
              <small>修改网站常规信箱的接收开关。</small>
            </span>
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(e) => {
                const nextEnabled = e.target.checked;
                void act(async () => {
                  const result = await client.settings.set(nextEnabled);
                  setEnabled(result.enabled);
                });
              }}
            />
          </label>
          <label className="setting-toggle">
            <span>
              <strong>敏感词辅助审核</strong>
              <small>
                关闭后不标记新来信，历史来信仍保留；播出始终需要人工批准。
              </small>
            </span>
            <input
              type="checkbox"
              checked={keywordEnabled}
              disabled={busy}
              onChange={(e) => {
                const nextEnabled = e.target.checked;
                void act(async () => {
                  if (
                    dirty &&
                    !(await confirm("敏感词列表尚未保存，切换功能并放弃编辑？"))
                  )
                    return;
                  const result = await client.request<{
                    blockedTermsEnabled: boolean;
                  }>("/settings", "PATCH", {
                    blockedTermsEnabled: nextEnabled,
                  });
                  setTerms(savedTerms);
                  onKeywordChange(result.blockedTermsEnabled);
                });
              }}
            />
          </label>
          {keywordEnabled && (
            <>
              <label>
                敏感词，每行一条
                <textarea
                  rows={8}
                  disabled={busy || !termsReady}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                />
              </label>
              <button
                className="wc-primary"
                disabled={busy || !dirty}
                onClick={() =>
                  void act(async () => {
                    const result = await client.blockedTerms.set(
                      terms.split("\n"),
                    );
                    setTerms(result.terms.join("\n"));
                    setSavedTerms(result.terms.join("\n"));
                  })
                }
              >
                保存敏感词
              </button>
            </>
          )}
        </article>
        <article className="glass-surface settings-card">
          <h2>已屏蔽发送者</h2>
          {blocked.length ? (
            blocked.map((sender) => (
              <div className="blocked-sender" key={sender.hash}>
                <strong>{sender.label || "匿名发送者"}</strong>
                <small>
                  {new Date(sender.blockedAt).toLocaleString("zh-CN")}
                </small>
                <p>{sender.sampleText}</p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      if (await confirm("解除此发送者的全站屏蔽？")) {
                        await client.blocklist.unblock(sender.hash);
                        setBlocked(await client.blocklist.list());
                      }
                    })
                  }
                >
                  解除屏蔽
                </button>
              </div>
            ))
          ) : (
            <p className="empty-copy">暂时没有屏蔽记录。</p>
          )}
        </article>
        <article className="glass-surface settings-card">
          <h2>网站授权</h2>
          <p className="wc-muted">
            连接密钥只在网站后台生成。撤销会同时停止使用该密钥的电脑及其派生展示授权。
          </p>
          {grants
            .filter((grant) => grant.kind === "control")
            .map((grant) => (
              <div className="blocked-sender" key={grant.id}>
                <strong>{grant.label || "未命名授权"}</strong>
                <small>
                  {grant.scope === "site" ? "站点" : "话题"}授权 · 到期{" "}
                  {new Date(grant.expiresAt).toLocaleString("zh-CN")}
                </small>
                <button
                  disabled={busy || !!grant.revokedAt}
                  onClick={() =>
                    void act(async () => {
                      if (
                        await confirm(
                          "撤销此连接密钥？如果这是本机当前密钥，撤销后会立即断开连接。",
                        )
                      ) {
                        await client.request(
                          `/grants/${encodeURIComponent(grant.id)}`,
                          "DELETE",
                        );
                        setGrants((current) =>
                          current.map((item) =>
                            item.id === grant.id
                              ? { ...item, revokedAt: new Date().toISOString() }
                              : item,
                          ),
                        );
                      }
                    })
                  }
                >
                  {grant.revokedAt ? "已撤销" : "撤销授权"}
                </button>
              </div>
            ))}
        </article>
      </div>
    </section>
  );
}
type ShareData = {
  siteName: string;
  origin: string;
  topicId: string;
  topicTitle: string;
  submissionUrl: string;
  posterDefaults?: { title?: string; subtitle?: string; signature?: string };
};
export function Share({
  client,
  topicId,
  siteId,
  onError,
}: {
  client: WindChimeClient;
  topicId: string;
  siteId: string;
  onError(message: string): void;
}) {
  const [share, setShare] = useState<ShareData | null>(null),
    [heading, setHeading] = useState(""),
    [body, setBody] = useState(""),
    [poster, setPoster] = useState<HTMLCanvasElement | null>(null),
    [ready, setReady] = useState(false);
  const qr = useRef<HTMLCanvasElement>(null),
    preview = useRef<HTMLCanvasElement>(null);
  const [footer, setFooter] = useState(""),
    [avatarSrc, setAvatarSrc] = useState(""),
    [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const storageKey = "windchime:poster:v1:" + siteId + ":" + topicId;
  useEffect(() => {
    if (
      preferencesLoaded &&
      !writeWindChimePosterConfig(storageKey, {
        heading,
        body,
        footer,
        avatarSrc,
      })
    )
      onError("海报偏好无法保存，请检查本机存储空间");
  }, [
    preferencesLoaded,
    storageKey,
    heading,
    body,
    footer,
    avatarSrc,
    onError,
  ]);
  useEffect(() => {
    const abort = new AbortController();
    void client
      .request<ShareData>("/share", "GET", undefined, {
        topicId,
        signal: abort.signal,
      })
      .then((data) => {
        if (!abort.signal.aborted) {
          setShare(data);
          const saved = readWindChimePosterConfig(storageKey, {
            heading: data.posterDefaults?.title || data.topicTitle,
            body:
              data.posterDefaults?.subtitle || "扫码匿名投稿",
            footer: data.posterDefaults?.signature || data.siteName,
            avatarSrc: "",
          });
          setHeading(saved.heading);
          setBody(saved.body);
          setFooter(saved.footer);
          setAvatarSrc(
            /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(saved.avatarSrc)
              ? saved.avatarSrc
              : "",
          );
          setPreferencesLoaded(true);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) onError(message(e));
      });
    return () => abort.abort();
  }, [client, topicId, storageKey, onError]);
  useEffect(() => {
    if (!share || !qr.current) return;
    let disposed = false;
    setReady(false);
    const canvas = qr.current;
    void renderWindChimeQr(canvas, {
      url: share.submissionUrl,
      size: 320,
      foreground: "#263A58",
      background: "#ffffff",
      pixelRatio: 1,
    })
      .then(() =>
        renderWindChimePoster(canvas, {
          url: share.submissionUrl,
          heading,
          body,
          footer,
          avatarSrc: avatarSrc || undefined,
          brandingText: share.siteName,
          gradient: ["#eef5fb", "#e1f1ef"],
          textColor: "#263A58",
          width: 720,
        }),
      )
      .then((canvas) => {
        if (disposed || !preview.current) return;
        preview.current.width = canvas.width;
        preview.current.height = canvas.height;
        preview.current.getContext("2d")?.drawImage(canvas, 0, 0);
        setPoster(canvas);
        setReady(true);
      })
      .catch((e) => {
        if (!disposed) onError(message(e));
      });
    return () => {
      disposed = true;
    };
  }, [share, heading, body, footer, avatarSrc, onError]);
  const save = async (canvas: HTMLCanvasElement | null, name: string) => {
    if (!canvas) return;
    try {
      const blob = await windChimeCanvasToBlob(canvas);
      await unwrap(
        bridge.saveFile({
          kind: "png",
          name,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        }),
      );
    } catch (e) {
      onError(message(e));
    }
  };
  return (
    <section className="management wc-live" aria-label="投稿分享">
      <div className="share-grid">
        <article className="glass-surface settings-card">
          <h2>把投稿入口分享出去</h2>
          <p className="wc-muted">{share?.topicTitle || "正在读取话题…"}</p>
          <label>
            投稿地址
            <input readOnly value={share?.submissionUrl ?? ""} />
          </label>
          <button
            disabled={!share}
            onClick={() =>
              void unwrap(bridge.openSubmission()).catch((e) =>
                onError(message(e)),
              )
            }
          >
            在浏览器打开投稿页
          </button>
          <canvas ref={qr} className="share-qr" aria-label="投稿二维码" />
          <button
            disabled={!ready}
            onClick={() => void save(qr.current, "风铃投稿二维码.png")}
          >
            保存二维码 PNG
          </button>
          <label>
            海报标题
            <input
              maxLength={80}
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
            />
          </label>
          <label>
            海报文案
            <textarea
              maxLength={500}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <label>
            海报署名
            <input
              aria-label="海报署名"
              maxLength={100}
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
            />
          </label>
          <div className="poster-avatar">
            {avatarSrc && <img src={avatarSrc} alt="海报头像" />}
            <button
              onClick={() =>
                void unwrap(bridge.chooseAvatar())
                  .then((result) => {
                    if (result)
                      setAvatarSrc(
                        `data:${result.mimeType};base64,${result.image}`,
                      );
                  })
                  .catch((e) => onError(message(e)))
              }
            >
              选择本机头像
            </button>
            {avatarSrc && (
              <button onClick={() => setAvatarSrc("")}>移除头像</button>
            )}
          </div>
          <p className="wc-muted">
            标题、文案、署名和头像仅保存在此电脑；不会修改网站或来信。
          </p>
          <button
            className="wc-primary"
            disabled={!ready}
            onClick={() => void save(poster, "风铃投稿海报.png")}
          >
            保存海报 PNG
          </button>
        </article>
        <article className="glass-surface poster-preview">
          <canvas ref={preview} aria-label="投稿海报预览" />
        </article>
      </div>
    </section>
  );
}
