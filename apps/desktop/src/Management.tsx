import { useCallback, useEffect, useRef, useState } from "react";
import type { WindChimeClient } from "../../../src/client";
import type { WindChimeLiveClient } from "../../../src/client/live";
import {
  windChimeLocalToUtcIso,
  windChimeUtcIsoToLocal,
  type WindChimeAdminTopic,
  type WindChimeBlockedSender,
  type WindChimeInboxFilter,
  type WindChimeMessageList,
  type WindChimeMessageRecord,
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
  liveClient,
  topicId,
  siteScope,
  keywordEnabled,
  onError,
  onNotice,
}: Common & { liveClient?: WindChimeLiveClient; onNotice?(message: string): void }) {
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
  const detailReady = detail?.id === active;
  const detailAssetsKey = detailReady
    ? detail.assets !== undefined
      ? detail.assets.map((asset) => asset.id).join(",")
      : "__legacy__"
    : "";
  useEffect(() => {
    const abort = new AbortController(),
      owned: string[] = [];
    setImages([]);
    if (!active || !detailReady) {
      return () => {
        abort.abort();
      };
    }
    const fetchAssetRows = async (
      assets: Array<{ id: string; caption?: string }>,
    ) => {
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
            !["image/png", "image/jpeg", "image/webp"].includes(result.mimeType)
          )
            throw new Error("无效图片格式");
          const blob = new Blob(
              [Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0))],
              { type: result.mimeType },
            ),
            url = URL.createObjectURL(blob);
          owned.push(url);
          return { url, caption: asset.caption ?? "" };
        }),
      );
      if (!abort.signal.aborted)
        setImages(
          rows.filter(
            (item): item is { url: string; caption: string } => !!item,
          ),
        );
    };
    if (detailAssetsKey === "__legacy__") {
      void client
        .request<WindChimeLiveControlState>("/state", "GET", undefined, {
          topicId,
          signal: abort.signal,
        })
        .then((state) =>
          fetchAssetRows(
            state.messages.find((item) => item.id === active)?.source.assets ??
              [],
          ),
        )
        .catch((e) => {
          if (!abort.signal.aborted) onError(message(e));
        });
    } else if (detailAssetsKey) {
      const ids = detailAssetsKey.split(",");
      void fetchAssetRows(ids.map((id) => ({ id }))).catch((e) => {
        if (!abort.signal.aborted) onError(message(e));
      });
    }
    return () => {
      abort.abort();
      owned.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [active, detailReady, detailAssetsKey, client, topicId, onError]);
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
  const visibleChecked = checked.filter((id) =>
    rows.some((row) => row.id === id),
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
  const approveIds = async (ids: string[]) => {
    if (!liveClient || !ids.length) return;
    let state = await liveClient.state(topicId);
    let approvedCount = 0;
    for (const id of ids) {
      const target = state.messages.find((m) => m.id === id);
      if (!target || target.status === "approved") continue;
      state = await liveClient.action({
        topicId,
        action: "approve",
        messageId: target.id,
        expectedRevision: state.revision,
        expectedDraftRevision: target.draftRevision,
        operationId: crypto.randomUUID(),
      });
      approvedCount++;
    }
    if (approvedCount > 0) {
      onNotice?.(
        approvedCount === 1
          ? "已批准加入待播列表，可在直播工作台直接上屏。"
          : `已批量批准 ${approvedCount} 封来信加入待播列表。`,
      );
    } else {
      onNotice?.("所选来信已在待播列表中。");
    }
  };
  const exportCsv = () =>
    void act(async () => {
      const items = visibleChecked.length
        ? rows.filter((row) => visibleChecked.includes(row.id))
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
              rows.length > 0 && visibleChecked.length === rows.length
            }
            onChange={(e) =>
              setChecked(e.target.checked ? rows.map((row) => row.id) : [])
            }
          />{" "}
          选择当前列表
        </label>
        <span>已选 {visibleChecked.length} 封</span>
        <button
          disabled={busy || !visibleChecked.length}
          onClick={() =>
            void act(() =>
              client.messages.batch("markRead", visibleChecked, { topicId }),
            )
          }
        >
          批量标为已读
        </button>
        {liveClient && (
          <button
            className="wc-primary"
            disabled={busy || !visibleChecked.length}
            onClick={() =>
              void act(async () => {
                await approveIds(visibleChecked);
                setChecked([]);
              })
            }
          >
            批量批准待播
          </button>
        )}
        <button
          disabled={busy || !visibleChecked.length}
          onClick={() =>
            void act(async () => {
              if (
                await confirm(
                  `删除已选的 ${visibleChecked.length} 封来信？对应待播和正在展示的内容会同步撤下。`,
                )
              )
                await client.messages.batch("delete", visibleChecked, {
                  topicId,
                });
            })
          }
        >
          批量删除
        </button>
        <button disabled={busy || !rows.length} onClick={exportCsv}>
          导出 {visibleChecked.length ? "所选" : "当前列表"} CSV
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
                {liveClient && (
                  <button
                    className="wc-primary"
                    disabled={busy}
                    onClick={() => void act(() => approveIds([item.id]))}
                  >
                    批准进入待播
                  </button>
                )}
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
  const editingTopic =
    editing && editing !== "new"
      ? (topics.find((item) => item.id === editing) ?? null)
      : null;
  const isDefaultEditing = Boolean(editingTopic?.isDefault);
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
            startsAt: windChimeUtcIsoToLocal(topic.startsAt),
            endsAt: windChimeUtcIsoToLocal(topic.endsAt),
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
      if (editing === "new") {
        await client.topics.create({
          ...form,
          slug: form.slug.trim().toLowerCase(),
          startsAt: form.startsAt
            ? windChimeLocalToUtcIso(form.startsAt) || null
            : null,
          endsAt: form.endsAt
            ? windChimeLocalToUtcIso(form.endsAt) || null
            : null,
        });
      } else if (editing) {
        const patch = isDefaultEditing
          ? {
              title: form.title,
              description: form.description,
              isEnabled: form.isEnabled,
            }
          : {
              title: form.title,
              description: form.description,
              note: form.note,
              isEnabled: form.isEnabled,
              sortOrder: form.sortOrder,
              startsAt: form.startsAt
                ? windChimeLocalToUtcIso(form.startsAt) || null
                : null,
              endsAt: form.endsAt
                ? windChimeLocalToUtcIso(form.endsAt) || null
                : null,
            };
        await client.topics.update(editing, patch);
      }
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
                  maxLength={64}
                  value={form.title}
                  onChange={(e) => field("title", e.target.value)}
                />
              </label>
              <label>
                链接短名
                <input
                  required
                  maxLength={64}
                  disabled={editing !== "new"}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={form.slug}
                  onChange={(e) => field("slug", e.target.value.toLowerCase())}
                />
              </label>
              {!isDefaultEditing && (
                <>
                  <label>
                    开始时间（北京时间）
                    <input
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(e) => field("startsAt", e.target.value)}
                    />
                  </label>
                  <label>
                    结束时间（北京时间）
                    <input
                      type="datetime-local"
                      value={form.endsAt}
                      onChange={(e) => field("endsAt", e.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
            <label>
              公开说明
              <textarea
                value={form.description}
                maxLength={500}
                onChange={(e) => field("description", e.target.value)}
              />
            </label>
            {!isDefaultEditing && (
              <label>
                私人备注
                <textarea
                  value={form.note}
                  maxLength={500}
                  onChange={(e) => field("note", e.target.value)}
                />
              </label>
            )}
            <div className="wc-actions">
              <label>
                <input
                  type="checkbox"
                  checked={form.isEnabled}
                  onChange={(e) => field("isEnabled", e.target.checked)}
                />{" "}
                允许投稿
              </label>
              {!isDefaultEditing && (
                <label>
                  排列序号
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => field("sortOrder", Number(e.target.value))}
                  />
                </label>
              )}
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
  section = "all",
}: {
  client: WindChimeClient;
  siteScope: boolean;
  keywordEnabled: boolean;
  onKeywordChange(enabled: boolean): void;
  onError(message: string): void;
  onDirtyChange?(dirty: boolean): void;
  section?: "all" | "safety" | "grants";
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
        <article className="glass-surface settings-card" hidden={section === "grants"}>
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
        <article className="glass-surface settings-card" hidden={section === "grants"}>
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
        <article className="glass-surface settings-card" hidden={section === "safety"}>
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
  posterDefaults?: {
    title?: string;
    subtitle?: string;
    signature?: string;
    avatarUrl?: string;
    qrForeground?: string;
    qrBackground?: string;
    qrLogoUrl?: string;
    gradient?: [string, string];
    textColor?: string;
    backgroundImageUrl?: string;
    backgroundImageOpacity?: number;
    backgroundImageOverlay?: string;
    brandingText?: string;
  };
};
type PosterStyleState = {
  presetId: string;
  qrForeground: string;
  qrBackground: string;
  qrLogoSrc: string;
  gradientStart: string;
  gradientEnd: string;
  textColor: string;
  backgroundImageSrc: string;
  overlayOpacity: number;
  brandingText: string;
};
const SHARE_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  style: Omit<PosterStyleState, "presetId" | "qrLogoSrc" | "backgroundImageSrc">;
}> = [
  {
    id: "web-default",
    label: "网页默认 · 紫粉流光",
    style: {
      qrForeground: "#1f2937",
      qrBackground: "#ffffff",
      gradientStart: "#8b5cf6",
      gradientEnd: "#ec4899",
      textColor: "#ffffff",
      overlayOpacity: 38,
      brandingText: "",
    },
  },
  {
    id: "uliuli",
    label: "UliUli · 赛博夜航",
    style: {
      qrForeground: "#2de2e6",
      qrBackground: "#050508",
      gradientStart: "#050508",
      gradientEnd: "#1a1033",
      textColor: "#ffffff",
      overlayOpacity: 55,
      brandingText: "🎐 WindChime 匿名提问箱",
    },
  },
  {
    id: "glass",
    label: "琉璃浅青",
    style: {
      qrForeground: "#263A58",
      qrBackground: "#ffffff",
      gradientStart: "#eef5fb",
      gradientEnd: "#e1f1ef",
      textColor: "#263A58",
      overlayOpacity: 25,
      brandingText: "",
    },
  },
  {
    id: "midnight",
    label: "暗夜星穹",
    style: {
      qrForeground: "#e2e8f0",
      qrBackground: "#0f172a",
      gradientStart: "#0f172a",
      gradientEnd: "#1e293b",
      textColor: "#f8fafc",
      overlayOpacity: 45,
      brandingText: "",
    },
  },
];
function isSafeSavedImage(value: string) {
  return (
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ||
    /^https?:\/\/\S+$/.test(value) ||
    /^\/[^\s]*$/.test(value)
  );
}
function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
function parseOverlayOpacity(overlay?: string): number {
  if (!overlay) return 45;
  const m = /rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)/i.exec(overlay);
  if (!m) return 45;
  const alpha = Number(m[1]);
  return Number.isFinite(alpha) ? Math.round(Math.min(85, Math.max(0, alpha * 100))) : 45;
}
function defaultStyleFromShare(data: ShareData): PosterStyleState {
  const d = data.posterDefaults ?? {};
  const hasServerTheme = Boolean(
    d.qrForeground ||
    d.qrBackground ||
    d.gradient ||
    d.textColor ||
    d.backgroundImageUrl ||
    d.brandingText,
  );
  const base = SHARE_PRESETS[0]!.style;
  return {
    presetId: hasServerTheme ? "site" : "web-default",
    qrForeground: isHexColor(d.qrForeground) ? d.qrForeground : base.qrForeground,
    qrBackground: isHexColor(d.qrBackground) ? d.qrBackground : base.qrBackground,
    qrLogoSrc: typeof d.qrLogoUrl === "string" && isSafeSavedImage(d.qrLogoUrl) ? d.qrLogoUrl : "",
    gradientStart: Array.isArray(d.gradient) && isHexColor(d.gradient[0]) ? d.gradient[0] : base.gradientStart,
    gradientEnd: Array.isArray(d.gradient) && isHexColor(d.gradient[1]) ? d.gradient[1] : base.gradientEnd,
    textColor: isHexColor(d.textColor) ? d.textColor : base.textColor,
    backgroundImageSrc:
      typeof d.backgroundImageUrl === "string" && isSafeSavedImage(d.backgroundImageUrl)
        ? d.backgroundImageUrl
        : "",
    overlayOpacity: parseOverlayOpacity(d.backgroundImageOverlay),
    brandingText: typeof d.brandingText === "string" ? d.brandingText.slice(0, 60) : base.brandingText,
  };
}
function readPosterStyle(key: string, fallback: PosterStyleState): PosterStyleState {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return fallback;
    return {
      presetId: typeof raw.presetId === "string" ? raw.presetId : fallback.presetId,
      qrForeground: isHexColor(raw.qrForeground) ? raw.qrForeground : fallback.qrForeground,
      qrBackground: isHexColor(raw.qrBackground) ? raw.qrBackground : fallback.qrBackground,
      qrLogoSrc: typeof raw.qrLogoSrc === "string" && isSafeSavedImage(raw.qrLogoSrc) ? raw.qrLogoSrc : fallback.qrLogoSrc,
      gradientStart: isHexColor(raw.gradientStart) ? raw.gradientStart : fallback.gradientStart,
      gradientEnd: isHexColor(raw.gradientEnd) ? raw.gradientEnd : fallback.gradientEnd,
      textColor: isHexColor(raw.textColor) ? raw.textColor : fallback.textColor,
      backgroundImageSrc:
        typeof raw.backgroundImageSrc === "string" && isSafeSavedImage(raw.backgroundImageSrc)
          ? raw.backgroundImageSrc
          : fallback.backgroundImageSrc,
      overlayOpacity:
        typeof raw.overlayOpacity === "number" && Number.isFinite(raw.overlayOpacity)
          ? Math.round(Math.min(85, Math.max(0, raw.overlayOpacity)))
          : fallback.overlayOpacity,
      brandingText: typeof raw.brandingText === "string" ? raw.brandingText.slice(0, 60) : fallback.brandingText,
    };
  } catch {
    return fallback;
  }
}
async function normalizeDataUrlInCanvas(
  dataUrl: string,
  maxEdge: number,
  format: "image/png" | "image/jpeg",
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const node = new Image();
    node.onload = () => resolve(node);
    node.onerror = () => reject(new Error("图片解码失败"));
    node.src = dataUrl;
  });
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return format === "image/jpeg" ? c.toDataURL("image/jpeg", 0.86) : c.toDataURL("image/png");
}
export function Share({
  client,
  topicId,
  siteId,
  onError,
  onNotice,
}: {
  client: WindChimeClient;
  topicId: string;
  siteId: string;
  onError(message: string): void;
  onNotice?(message: string): void;
}) {
  const [share, setShare] = useState<ShareData | null>(null),
    [heading, setHeading] = useState(""),
    [body, setBody] = useState(""),
    [poster, setPoster] = useState<HTMLCanvasElement | null>(null),
    [ready, setReady] = useState(false),
    [copiedUrl, setCopiedUrl] = useState(false);
  const qr = useRef<HTMLCanvasElement>(null),
    preview = useRef<HTMLCanvasElement>(null);
  const [footer, setFooter] = useState(""),
    [avatarSrc, setAvatarSrc] = useState(""),
    [avatarUrlDraft, setAvatarUrlDraft] = useState(""),
    [bgUrlDraft, setBgUrlDraft] = useState(""),
    [style, setStyle] = useState<PosterStyleState>({
      presetId: "web-default",
      ...SHARE_PRESETS[0]!.style,
      qrLogoSrc: "",
      backgroundImageSrc: "",
    }),
    [loadedKey, setLoadedKey] = useState<string | null>(null);
  const resolvedCacheRef = useRef(new Map<string, string>());
  const copyTimerRef = useRef<number | null>(null);
  const storageKey = "windchime:poster:v1:" + siteId + ":" + topicId;
  const styleStorageKey = "windchime:poster-style:v1:" + siteId + ":" + topicId;

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const resolveForCanvas = useCallback(async (src: string): Promise<string | undefined> => {
    const trimmed = src.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith("data:image/")) return trimmed;
    const cached = resolvedCacheRef.current.get(trimmed);
    if (cached) return cached;
    const fetched = await unwrap(bridge.fetchShareImage(trimmed));
    const dataUrl = `data:${fetched.mimeType};base64,${fetched.image}`;
    resolvedCacheRef.current.set(trimmed, dataUrl);
    return dataUrl;
  }, []);

  useEffect(() => {
    if (loadedKey !== storageKey) return;
    if (
      !writeWindChimePosterConfig(storageKey, {
        heading,
        body,
        footer,
        avatarSrc,
      })
    ) {
      onError("海报偏好无法保存，请检查本机存储空间");
    }
  }, [loadedKey, storageKey, heading, body, footer, avatarSrc, onError]);

  useEffect(() => {
    if (loadedKey !== storageKey) return;
    try {
      localStorage.setItem(styleStorageKey, JSON.stringify(style));
    } catch {
      onError("海报配色或背景图偏好超过本机存储上限，请尝试更小的图片");
    }
  }, [loadedKey, storageKey, styleStorageKey, style, onError]);

  useEffect(() => {
    const abort = new AbortController();
    setLoadedKey(null);
    setShare(null);
    setReady(false);
    void client
      .request<ShareData>("/share", "GET", undefined, {
        topicId,
        signal: abort.signal,
      })
      .then((data) => {
        if (abort.signal.aborted) return;
        setShare(data);
        const saved = readWindChimePosterConfig(storageKey, {
          heading: data.posterDefaults?.title || data.topicTitle,
          body: data.posterDefaults?.subtitle || "扫码匿名投稿",
          footer: data.posterDefaults?.signature ?? "",
          avatarSrc:
            typeof data.posterDefaults?.avatarUrl === "string" &&
            isSafeSavedImage(data.posterDefaults.avatarUrl)
              ? data.posterDefaults.avatarUrl
              : "",
        });
        const safeAvatar = isSafeSavedImage(saved.avatarSrc) ? saved.avatarSrc : "";
        setHeading(saved.heading);
        setBody(saved.body);
        setFooter(saved.footer);
        setAvatarSrc(safeAvatar);
        setAvatarUrlDraft(safeAvatar.startsWith("data:") ? "" : safeAvatar);
        const nextStyle = readPosterStyle(styleStorageKey, defaultStyleFromShare(data));
        setStyle(nextStyle);
        setBgUrlDraft(
          nextStyle.backgroundImageSrc.startsWith("data:") ? "" : nextStyle.backgroundImageSrc,
        );
        setLoadedKey(storageKey);
      })
      .catch((e) => {
        if (!abort.signal.aborted) onError(message(e));
      });
    return () => abort.abort();
  }, [client, topicId, storageKey, styleStorageKey, onError]);

  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [bgPreviewUrl, setBgPreviewUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!avatarSrc) { setAvatarPreviewUrl(""); return; }
    if (avatarSrc.startsWith("data:image/")) { setAvatarPreviewUrl(avatarSrc); return; }
    void resolveForCanvas(avatarSrc)
      .then((url) => { if (!cancelled) setAvatarPreviewUrl(url ?? ""); })
      .catch(() => { if (!cancelled) setAvatarPreviewUrl(""); });
    return () => { cancelled = true; };
  }, [avatarSrc, resolveForCanvas]);

  useEffect(() => {
    let cancelled = false;
    if (!style.backgroundImageSrc) { setBgPreviewUrl(""); return; }
    if (style.backgroundImageSrc.startsWith("data:image/")) { setBgPreviewUrl(style.backgroundImageSrc); return; }
    void resolveForCanvas(style.backgroundImageSrc)
      .then((url) => { if (!cancelled) setBgPreviewUrl(url ?? ""); })
      .catch(() => { if (!cancelled) setBgPreviewUrl(""); });
    return () => { cancelled = true; };
  }, [style.backgroundImageSrc, resolveForCanvas]);

  useEffect(() => {
    if (!share || !qr.current || loadedKey !== storageKey) return;
    let disposed = false;
    setReady(false);
    const canvas = qr.current;
    void (async () => {
      const [resolvedAvatar, resolvedBg, resolvedLogo] = await Promise.all([
        avatarSrc ? resolveForCanvas(avatarSrc).catch(() => undefined) : Promise.resolve(undefined),
        style.backgroundImageSrc ? resolveForCanvas(style.backgroundImageSrc).catch(() => undefined) : Promise.resolve(undefined),
        style.qrLogoSrc ? resolveForCanvas(style.qrLogoSrc).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      if (disposed) return;
      const dpr = Math.max(2, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);
      await renderWindChimeQr(canvas, {
        url: share.submissionUrl,
        size: 320,
        foreground: style.qrForeground,
        background: style.qrBackground,
        margin: 2,
        errorCorrectionLevel: "H",
        logoSrc: resolvedLogo,
        pixelRatio: dpr,
      });
      if (disposed) return;
      const posterCanvas = await renderWindChimePoster(canvas, {
        url: share.submissionUrl,
        heading,
        body,
        footer,
        avatarSrc: resolvedAvatar,
        brandingText: style.brandingText || undefined,
        gradient: [style.gradientStart, style.gradientEnd],
        textColor: style.textColor,
        backgroundImageSrc: resolvedBg,
        backgroundImageOverlay: `rgba(5,5,8,${(style.overlayOpacity / 100).toFixed(2)})`,
        width: 900,
      });
      if (disposed || !preview.current) return;
      preview.current.width = posterCanvas.width;
      preview.current.height = posterCanvas.height;
      preview.current.getContext("2d")?.drawImage(posterCanvas, 0, 0);
      setPoster(posterCanvas);
      setReady(true);
    })().catch((e) => {
      if (!disposed) onError(message(e));
    });
    return () => {
      disposed = true;
    };
  }, [share, loadedKey, storageKey, heading, body, footer, avatarSrc, style, resolveForCanvas, onError]);

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
  const copySubmissionUrl = async () => {
    if (!share?.submissionUrl) return;
    try {
      await unwrap(bridge.writeClipboard(share.submissionUrl));
      setCopiedUrl(true);
      onNotice?.("已复制投稿地址到剪贴板。");
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedUrl(false);
        copyTimerRef.current = null;
      }, 2000);
    } catch {
      onError("剪贴板写入失败，请手动全选复制投稿地址");
    }
  };
  const pickLocalImage = async (purpose: "avatar" | "background" | "logo") => {
    try {
      const result =
        purpose === "avatar"
          ? await unwrap(bridge.chooseAvatar())
          : await unwrap(bridge.choosePosterImage(purpose));
      if (!result) return;
      const rawDataUrl = `data:${result.mimeType};base64,${result.image}`;
      const normalized =
        purpose === "background"
          ? await normalizeDataUrlInCanvas(rawDataUrl, 1280, "image/jpeg")
          : await normalizeDataUrlInCanvas(rawDataUrl, purpose === "logo" ? 256 : 512, "image/png");
      if (purpose === "avatar") {
        setAvatarSrc(normalized);
        setAvatarUrlDraft("");
      } else if (purpose === "background") {
        setStyle((cur) => ({ ...cur, presetId: "custom", backgroundImageSrc: normalized }));
        setBgUrlDraft("");
      } else {
        setStyle((cur) => ({ ...cur, presetId: "custom", qrLogoSrc: normalized }));
      }
    } catch (e) {
      onError(message(e));
    }
  };
  const applyPreset = (preset: (typeof SHARE_PRESETS)[number]) => {
    setStyle((cur) => ({
      ...cur,
      ...preset.style,
      presetId: preset.id,
      backgroundImageSrc:
        preset.id === "uliuli" && !cur.backgroundImageSrc
          ? "/Background.webp"
          : cur.backgroundImageSrc,
    }));
    if (preset.id === "uliuli" && !style.backgroundImageSrc) {
      setBgUrlDraft("/Background.webp");
    }
  };
  const resetToSiteDefaults = () => {
    if (!share) return;
    setHeading(share.posterDefaults?.title || share.topicTitle);
    setBody(share.posterDefaults?.subtitle || "扫码匿名投稿");
    setFooter(share.posterDefaults?.signature ?? "");
    const defaultAvatar =
      typeof share.posterDefaults?.avatarUrl === "string" &&
      isSafeSavedImage(share.posterDefaults.avatarUrl)
        ? share.posterDefaults.avatarUrl
        : "";
    setAvatarSrc(defaultAvatar);
    setAvatarUrlDraft(defaultAvatar);
    const nextStyle = defaultStyleFromShare(share);
    setStyle(nextStyle);
    setBgUrlDraft(nextStyle.backgroundImageSrc.startsWith("data:") ? "" : nextStyle.backgroundImageSrc);
    onNotice?.("已恢复站点默认海报与二维码样式。");
  };

  return (
    <section className="management wc-live" aria-label="投稿分享">
      <div className="share-grid">
        <article className="glass-surface settings-card">
          <h2>把投稿入口分享出去</h2>
          <p className="wc-muted">{share?.topicTitle || "正在读取话题…"}</p>
          <label>
            投稿地址
            <div className="share-url-row">
              <input readOnly value={share?.submissionUrl ?? ""} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" disabled={!share} onClick={() => void copySubmissionUrl()}>
                {copiedUrl ? "已复制 ✓" : "复制地址"}
              </button>
              <button
                type="button"
                disabled={!share}
                onClick={() =>
                  void unwrap(bridge.openSubmission()).catch((e) =>
                    onError(message(e)),
                  )
                }
              >
                在浏览器打开投稿页
              </button>
            </div>
          </label>
          <canvas ref={qr} className="share-qr" aria-label="投稿二维码" />
          <div className="share-actions-row">
            <button
              type="button"
              disabled={!ready}
              onClick={() => void save(qr.current, "风铃投稿二维码.png")}
            >
              保存二维码 PNG
            </button>
            <button type="button" onClick={() => void pickLocalImage("logo")}>
              {style.qrLogoSrc ? "更换二维码 Logo" : "添加二维码中心 Logo"}
            </button>
            {style.qrLogoSrc && (
              <button
                type="button"
                onClick={() => setStyle((cur) => ({ ...cur, qrLogoSrc: "" }))}
              >
                移除 Logo
              </button>
            )}
          </div>

          <label>
            风格预设（与网页 CMS 一键对齐）
            <div className="share-preset-row">
              {SHARE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={style.presetId === preset.id}
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
              <button type="button" disabled={!share} onClick={resetToSiteDefaults}>
                恢复默认
              </button>
            </div>
          </label>

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
            海报署名（留空则显示网址）
            <input
              aria-label="海报署名"
              maxLength={100}
              value={footer}
              placeholder={share?.submissionUrl.replace(/^https?:\/\//i, "") || ""}
              onChange={(e) => setFooter(e.target.value)}
            />
          </label>
          <label>
            底部品牌标语（可选）
            <input
              maxLength={60}
              value={style.brandingText}
              placeholder="例如：🎐 WindChime 匿名提问箱"
              onChange={(e) =>
                setStyle((cur) => ({ ...cur, presetId: "custom", brandingText: e.target.value }))
              }
            />
          </label>

          <div className="share-color-grid">
            <label>
              二维码前景色
              <input
                type="color"
                value={style.qrForeground}
                onChange={(e) =>
                  setStyle((cur) => ({ ...cur, presetId: "custom", qrForeground: e.target.value }))
                }
              />
            </label>
            <label>
              二维码背景色
              <input
                type="color"
                value={style.qrBackground}
                onChange={(e) =>
                  setStyle((cur) => ({ ...cur, presetId: "custom", qrBackground: e.target.value }))
                }
              />
            </label>
            <label>
              海报渐变起色
              <input
                type="color"
                value={style.gradientStart}
                onChange={(e) =>
                  setStyle((cur) => ({ ...cur, presetId: "custom", gradientStart: e.target.value }))
                }
              />
            </label>
            <label>
              海报渐变止色
              <input
                type="color"
                value={style.gradientEnd}
                onChange={(e) =>
                  setStyle((cur) => ({ ...cur, presetId: "custom", gradientEnd: e.target.value }))
                }
              />
            </label>
            <label>
              海报文字色
              <input
                type="color"
                value={style.textColor}
                onChange={(e) =>
                  setStyle((cur) => ({ ...cur, presetId: "custom", textColor: e.target.value }))
                }
              />
            </label>
          </div>

          <div className="poster-avatar">
            {avatarPreviewUrl && <img src={avatarPreviewUrl} alt="海报头像" />}
            <button type="button" onClick={() => void pickLocalImage("avatar")}>
              选择本机头像
            </button>
            {avatarSrc && (
              <button
                type="button"
                onClick={() => {
                  setAvatarSrc("");
                  setAvatarUrlDraft("");
                }}
              >
                移除头像
              </button>
            )}
          </div>
          <label>
            或填入头像 URL（支持 B站 hdslb.com 头像）
            <div className="share-url-row">
              <input
                value={avatarUrlDraft}
                placeholder="https://i0.hdslb.com/... 或 /avatar.png"
                onChange={(e) => setAvatarUrlDraft(e.target.value)}
              />
              <button
                type="button"
                disabled={!avatarUrlDraft.trim() || avatarUrlDraft.trim() === avatarSrc}
                onClick={() => {
                  const next = avatarUrlDraft.trim();
                  if (!isSafeSavedImage(next)) {
                    onError("请输入以 https://、http:// 或 / 开头的图片地址");
                    return;
                  }
                  setAvatarSrc(next);
                }}
              >
                应用头像 URL
              </button>
            </div>
          </label>

          <div className="share-bg-row">
            {bgPreviewUrl && <img className="share-bg-thumb" src={bgPreviewUrl} alt="海报背景图预览" />}
            <button type="button" onClick={() => void pickLocalImage("background")}>
              {style.backgroundImageSrc ? "更换海报背景图" : "选择本机海报背景图"}
            </button>
            {style.backgroundImageSrc && (
              <button
                type="button"
                onClick={() => {
                  setStyle((cur) => ({ ...cur, presetId: "custom", backgroundImageSrc: "" }));
                  setBgUrlDraft("");
                }}
              >
                移除背景图
              </button>
            )}
          </div>
          <label>
            或填入站点 / 网络背景图地址（例如 /Background.webp）
            <div className="share-url-row">
              <input
                value={bgUrlDraft}
                placeholder="/Background.webp 或 https://..."
                onChange={(e) => setBgUrlDraft(e.target.value)}
              />
              <button
                type="button"
                disabled={!bgUrlDraft.trim() || bgUrlDraft.trim() === style.backgroundImageSrc}
                onClick={() => {
                  const next = bgUrlDraft.trim();
                  if (!isSafeSavedImage(next)) {
                    onError("请输入以 / 或 https:// 开头的背景图路径");
                    return;
                  }
                  setStyle((cur) => ({ ...cur, presetId: "custom", backgroundImageSrc: next }));
                }}
              >
                应用背景图
              </button>
            </div>
          </label>
          {style.backgroundImageSrc && (
            <label>
              {`背景图暗角蒙层浓度：${style.overlayOpacity}%`}
              <input
                type="range"
                min={0}
                max={85}
                step={5}
                value={style.overlayOpacity}
                onChange={(e) =>
                  setStyle((cur) => ({
                    ...cur,
                    presetId: "custom",
                    overlayOpacity: Number(e.target.value),
                  }))
                }
              />
            </label>
          )}

          <p className="wc-muted">
            海报标题、文案、署名、配色、背景图和头像仅保存在此电脑（导出为 900px 高清海报与 2x 锐利二维码），不会修改网站或来信。
          </p>
          <button
            type="button"
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
