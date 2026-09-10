"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createWindChimeClient,
  downloadWindChimeCsv,
  WindChimeClientError,
} from "@windchime/embed/client";
import {
  useWindChimeInbox,
  useWindChimeTopics,
  useWindChimeBlocklist,
  useWindChimeBlockedTerms,
  useWindChimeReview,
  useWindChimePosterConfig,
} from "@windchime/embed/react";
import {
  downloadWindChimeCanvas,
  renderWindChimeQr,
  renderWindChimePoster,
} from "@windchime/embed/media";
import {
  validateWindChimeTopicCreate,
  validateWindChimeTopicPatch,
  type WindChimeAdminTopic as WindChimeTopic,
  type WindChimeTopicCreateInput,
} from "@windchime/embed/core";

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState(""),
    [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setAuthenticated(j.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);
  if (authenticated === null) return <p>检查登录状态…</p>;
  if (!authenticated)
    return (
      <>
        <h1>管理登录</h1>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (loggingIn) return;
            setLoggingIn(true);
            setError("");
            try {
              const r = await fetch("/api/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
              });
              const j = await r.json();
              if (!r.ok) throw new Error(j.error);
              setPassword("");
              setAuthenticated(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : "登录失败");
            } finally {
              setLoggingIn(false);
            }
          }}
        >
          <label>
            管理员密码
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button disabled={loggingIn}>{loggingIn ? "登录中…" : "登录"}</button>
          {error && <p role="alert">{error}</p>}
        </form>
      </>
    );
  return <Manager onLogout={() => setAuthenticated(false)} />;
}
function Manager({ onLogout }: { onLogout: () => void }) {
  const client = useMemo(() => createWindChimeClient(), []);
  const [topicId, setTopicId] = useState("default");
  const topics = useWindChimeTopics(client);
  const inbox = useWindChimeInbox(client, { topicId });
  const review = useWindChimeReview(client, {
    topicId,
    enabled: inbox.filter === "flagged",
  });
  const blocked = useWindChimeBlocklist(client),
    terms = useWindChimeBlockedTerms(client);
  const [error, setError] = useState(""),
    [termText, setTermText] = useState("");
  const [editing, setEditing] = useState<WindChimeTopic | "new" | null>(null);
  useEffect(() => {
    setTermText(terms.terms.join("\n"));
  }, [terms.data]);
  const topic = topics.items.find((t) => t.id === topicId);
  useEffect(() => {
    if (
      [
        topics.error,
        inbox.error,
        blocked.error,
        terms.error,
        review.detailError,
        topics.mutationError,
        inbox.mutationError,
        terms.mutationError,
        blocked.mutationError,
        review.mutationError,
      ].some((failure) => failure?.status === 401)
    )
      onLogout();
  }, [
    topics.error,
    inbox.error,
    blocked.error,
    terms.error,
    review.detailError,
    topics.mutationError,
    inbox.mutationError,
    terms.mutationError,
    blocked.mutationError,
    review.mutationError,
    onLogout,
  ]);
  async function act(operation: () => Promise<unknown>) {
    setError("");
    try {
      await operation();
    } catch (e) {
      if (e instanceof WindChimeClientError && e.status === 401) onLogout();
      else setError(e instanceof Error ? e.message : "操作失败");
    }
  }
  const failures = [
    error,
    inbox.error?.message,
    topics.error?.message,
    terms.error?.message,
    blocked.error?.message,
  ].filter(Boolean);
  return (
    <>
      <div className="actions">
        <h1>管理信箱</h1>
        <button
          onClick={() =>
            void act(async () => {
              const r = await fetch("/api/session", { method: "DELETE" });
              if (!r.ok) throw new Error("退出失败");
              onLogout();
            })
          }
        >
          退出登录
        </button>
      </div>
      {failures.map((failure, index) => (
        <p role="alert" key={index}>
          {failure}
        </p>
      ))}
      <section>
        <h2>话题</h2>
        <div className="actions">
          {topics.items.map((t) => (
            <button
              key={t.id}
              aria-pressed={t.id === topicId}
              onClick={() => setTopicId(t.id)}
            >
              {t.title}
              {t.archivedAt ? "（已归档）" : ""} · {t.unreadCount ?? 0} 未读
            </button>
          ))}
          <button onClick={() => setEditing("new")}>新建话题</button>
        </div>
        {topic && (
          <>
            <p>
              {topic.description} · {topic.state} ·{" "}
              {topic.isEnabled ? "开关已开启" : "开关已关闭"}
            </p>
            <div className="actions">
              <button
                disabled={topics.pending || !!topic.archivedAt}
                onClick={() =>
                  void act(() =>
                    topics.update(topic.id, { isEnabled: !topic.isEnabled }),
                  )
                }
              >
                {topic.isEnabled ? "暂停收信" : "开启收信"}
              </button>
              {!topic.archivedAt && (
                <button
                  disabled={topics.pending}
                  onClick={() => setEditing(topic)}
                >
                  编辑话题
                </button>
              )}
              {!topic.isDefault && !topic.archivedAt && (
                <>
                  <button
                    disabled={topics.pending}
                    onClick={() => {
                      if (
                        confirm(
                          `归档“${topic.title}”？未读 ${topic.unreadCount ?? 0}，待审核 ${topic.flaggedCount ?? 0}。`,
                        )
                      )
                        void act(() => topics.archive(topic.id));
                    }}
                  >
                    直接归档
                  </button>
                  <button
                    disabled={topics.pending}
                    onClick={() => {
                      if (
                        confirm(
                          "将该话题普通未读信件标为已读，然后归档？待审核信件保留原状态。",
                        )
                      )
                        void act(() =>
                          topics.archive(topic.id, { markReadFirst: true }),
                        );
                    }}
                  >
                    先标已读再归档
                  </button>
                </>
              )}
              {topic.archivedAt && (
                <>
                  <button
                    disabled={topics.pending}
                    onClick={() => void act(() => topics.restore(topic.id))}
                  >
                    恢复话题
                  </button>
                  <button
                    disabled={topics.pending}
                    onClick={() => {
                      if (confirm("永久删除此话题及全部信件？此操作不可恢复。"))
                        void act(async () => {
                          await topics.purge(topic.id);
                          setTopicId("default");
                        });
                    }}
                  >
                    永久删除话题
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </section>
      {editing && (
        <TopicEditor
          key={typeof editing === "string" ? editing : editing.id}
          topic={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === "new") {
              const created = await topics.create(
                validateWindChimeTopicCreate(input),
              );
              setTopicId(created.id);
            } else {
              const { slug: _slug, ...patch } = input;
              await topics.update(
                editing.id,
                validateWindChimeTopicPatch(
                  editing.isDefault
                    ? { title: patch.title, description: patch.description }
                    : patch,
                ),
              );
            }
            setEditing(null);
          }}
        />
      )}
      <div className="grid">
        <div>
          <section>
            <h2>来信</h2>
            <div className="actions">
              {(["all", "unread", "favorited", "flagged"] as const).map(
                (filter, i) => (
                  <button
                    key={filter}
                    aria-pressed={inbox.filter === filter}
                    onClick={() => inbox.setFilter(filter)}
                  >
                    {["全部", "未读", "收藏", "待审核"][i]}{" "}
                    {inbox.counts[filter]}
                  </button>
                ),
              )}
              <button onClick={() => void inbox.reload()}>刷新</button>
            </div>
            <label>
              <input
                type="checkbox"
                checked={inbox.allSelected}
                onChange={inbox.toggleAll}
              />{" "}
              全选当前列表
            </label>
            <div className="actions">
              <button
                disabled={!inbox.someSelected || !!inbox.pending}
                onClick={() => void act(() => inbox.batch("markRead"))}
              >
                批量已读
              </button>
              <button
                disabled={!inbox.someSelected || !!inbox.pending}
                onClick={() => {
                  if (confirm("删除选中的信件？"))
                    void act(() => inbox.batch("delete"));
                }}
              >
                批量删除
              </button>
              <button
                disabled={!inbox.items.length}
                onClick={() => downloadWindChimeCsv(inbox.items, "letters.csv")}
              >
                导出 CSV
              </button>
            </div>
            {inbox.isLoading && <p>加载中…</p>}
            {!inbox.isLoading && !inbox.items.length && <p>暂无来信。</p>}
            {inbox.items.map((item) => (
              <article key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={inbox.selectedIds.has(item.id)}
                    onChange={() => inbox.toggleSelected(item.id)}
                  />{" "}
                  选择信件
                </label>
                <time>{item.createdAt}</time>
                <p>
                  {item.isFlagged
                    ? "此信件需要审核，请明确打开原文。"
                    : item.text}
                </p>
                {!item.isFlagged && (
                  <p>
                    {item.nickname}{" "}
                    {item.linkUrl && (
                      <a href={item.linkUrl} target="_blank" rel="noreferrer">
                        相关链接
                      </a>
                    )}
                  </p>
                )}
                <p className="muted">{item.senderLabel}</p>
                <div className="actions">
                  {item.isFlagged && (
                    <button onClick={() => review.openDetail(item.id)}>
                      查看原文
                    </button>
                  )}
                  <button
                    disabled={!!inbox.pending}
                    onClick={() =>
                      void act(() => inbox.markRead(item.id, !item.isRead))
                    }
                  >
                    {item.isRead ? "标未读" : "标已读"}
                  </button>
                  <button
                    disabled={!!inbox.pending}
                    onClick={() =>
                      void act(() => inbox.toggleFavorite(item.id))
                    }
                  >
                    {item.isFavorited ? "取消收藏" : "收藏"}
                  </button>
                  <button
                    disabled={!!inbox.pending}
                    onClick={() => {
                      if (confirm("屏蔽此发送者并删除其全部话题内的既有信件？"))
                        void act(() => inbox.blockSender(item.id));
                    }}
                  >
                    屏蔽
                  </button>
                  <button
                    disabled={!!inbox.pending}
                    onClick={() => {
                      if (confirm("删除此信件？"))
                        void act(() => inbox.deleteMessage(item.id));
                    }}
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </section>
          {(review.detail || review.detailLoading || review.detailError) && (
            <section aria-label="审核原文">
              <h2>审核原文</h2>
              {review.detailLoading ? (
                <p>加载中…</p>
              ) : (
                <>
                  <p>{review.detail?.text}</p>
                  <p>{review.detail?.nickname}</p>
                  <p>{review.detail?.linkUrl}</p>
                </>
              )}
              {review.detailError && (
                <p role="alert">{review.detailError.message}</p>
              )}
              <div className="actions">
                <button onClick={review.closeDetail}>关闭原文</button>
                {review.detail && (
                  <button
                    disabled={review.pending}
                    onClick={() =>
                      void act(() => review.approve(review.detail!.id))
                    }
                  >
                    审核通过
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
        <aside>
          <section>
            <h2>敏感词</h2>
            <p>每行一个；命中后进入待审核，仍会保存。</p>
            <label>
              词库
              <textarea
                value={termText}
                onChange={(e) => setTermText(e.target.value)}
              />
            </label>
            <button
              disabled={terms.isLoading || terms.pending}
              onClick={() => void act(() => terms.save(termText.split("\n")))}
            >
              保存词库
            </button>
          </section>
          <section>
            <h2>屏蔽列表</h2>
            {blocked.items.map((item) => (
              <article key={item.hash}>
                <p>
                  {item.label} · {item.blockedAt}
                </p>
                <button
                  disabled={blocked.pending}
                  onClick={() => void act(() => blocked.unblock(item.hash))}
                >
                  解除屏蔽
                </button>
              </article>
            ))}
            {blocked.isLoading ? (
              <p>加载中…</p>
            ) : (
              !blocked.items.length && <p>暂无屏蔽记录。</p>
            )}
          </section>
          {topic && <Share key={topic.id} topic={topic} />}
        </aside>
      </div>
    </>
  );
}
function TopicEditor({
  topic,
  onClose,
  onSave,
}: {
  topic: WindChimeTopic | "new";
  onClose: () => void;
  onSave: (input: WindChimeTopicCreateInput) => Promise<void>;
}) {
  const value = topic === "new" ? null : topic;
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await onSave({
            slug: String(data.get("slug")),
            title: String(data.get("title")),
            description: String(data.get("description")),
            note: String(data.get("note")),
            startsAt: String(data.get("startsAt")).trim() || null,
            endsAt: String(data.get("endsAt")).trim() || null,
            sortOrder: Number(data.get("sortOrder")),
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "保存失败");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{value ? "编辑话题" : "新建话题"}</h2>
      <label>
        标题
        <input
          name="title"
          defaultValue={value?.title}
          maxLength={64}
          required
        />
      </label>
      <label>
        Slug
        <input
          name="slug"
          maxLength={64}
          defaultValue={value?.slug}
          readOnly={!!value}
          required
        />
      </label>
      <label>
        公开说明
        <textarea
          name="description"
          maxLength={500}
          defaultValue={value?.description ?? ""}
        />
      </label>
      <label>
        内部备注
        <textarea
          name="note"
          maxLength={500}
          disabled={!!value?.isDefault}
          defaultValue={value?.note ?? ""}
        />
      </label>
      <label>
        开始时间（UTC ISO，留空为立即）
        <input
          name="startsAt"
          disabled={!!value?.isDefault}
          placeholder="2026-09-09T08:00:00Z"
          defaultValue={value?.startsAt ?? ""}
        />
      </label>
      <label>
        结束时间（UTC ISO，留空为长期）
        <input
          name="endsAt"
          disabled={!!value?.isDefault}
          placeholder="2026-09-30T08:00:00Z"
          defaultValue={value?.endsAt ?? ""}
        />
      </label>
      <label>
        排序
        <input
          type="number"
          name="sortOrder"
          disabled={!!value?.isDefault}
          defaultValue={value?.sortOrder ?? 0}
        />
      </label>
      <button disabled={busy}>保存话题</button>{" "}
      <button type="button" onClick={onClose}>
        取消
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function Share({ topic }: { topic: WindChimeTopic }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState("");
  const [ready, setReady] = useState(false),
    [exporting, setExporting] = useState(false);
  const poster = useWindChimePosterConfig(
    {
      heading: "给我写一封信",
      body: "扫描二维码匿名投稿",
      footer: "",
      avatarSrc: "",
    },
    { storageKey: "example:poster" },
  );
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl(`${location.origin}${topic.isDefault ? "/" : `/m/${topic.slug}`}`);
  }, [topic.slug, topic.isDefault]);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError("");
    if (canvas.current && url)
      void renderWindChimeQr(canvas.current, { url })
        .then(() => {
          if (!cancelled) setReady(true);
        })
        .catch(() => {
          if (!cancelled) setError("二维码生成失败，请刷新后重试。");
        });
    return () => {
      cancelled = true;
    };
  }, [url]);
  async function download(withPoster: boolean) {
    if (!canvas.current || !ready || exporting) return;
    setExporting(true);
    setError("");
    try {
      const output = withPoster
        ? await renderWindChimePoster(canvas.current, { url, ...poster.value })
        : canvas.current;
      await downloadWindChimeCanvas(
        output,
        withPoster ? "poster.png" : "qr.png",
      );
    } catch {
      setError("导出失败，请检查图片地址是否允许跨域读取。");
    } finally {
      setExporting(false);
    }
  }
  return (
    <section>
      <h2>分享与海报</h2>
      <a href={url}>{url}</a>
      <canvas ref={canvas} aria-label="投稿二维码" />
      <div className="actions">
        <button
          disabled={!ready || exporting}
          onClick={() => void download(false)}
        >
          下载二维码
        </button>
        <button
          disabled={!ready || exporting}
          onClick={() => void download(true)}
        >
          下载海报
        </button>
      </div>
      {(["heading", "body", "footer", "avatarSrc"] as const).map((key, i) => (
        <label key={key}>
          {["主标题", "说明", "落款", "头像 URL"][i]}
          <input
            value={poster.value[key]}
            onChange={(e) => poster.update({ [key]: e.target.value })}
          />
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
