import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createWindChimeLiveClient } from "../../../src/client/live";
import { createWindChimeClient } from "../../../src/client";
import type { WindChimeAdminTopic } from "../../../src/core";
import { WindChimeLiveControlPanel, WINDCHIME_LIVE_MODULES } from "../../../src/broadcast/ControlPanel";
import { windChimeControlCss } from "../../../src/broadcast/styles";
import {
  assetTransport,
  transport,
  unwrap,
  managementFetch,
  type Site,
  type DesktopStatus,
} from "./bridge";
import { TileApp } from "./tiles";
import { Hotkeys } from "./Hotkeys";
import { Inbox, Topics, Share, GlobalSettings } from "./Management";
import { parseWindChimeConnectionKey } from "../../../src/core/connection-key";
import "./glass.css";
import "./management.css";
const bridge = window.windchimeDesktop;
type View =
  "inbox" | "studio" | "topics" | "share" | "settings" | "connections";
function Icon({
  name,
  size = 20,
}: {
  name: "inbox" | "link" | "palette" | "screen" | "hide" | "shield" | "arrow";
  size?: number;
}) {
  const paths = {
    inbox: (
      <>
        <path d="M4 5h16v14H4z" />
        <path d="M4 13h5l2 3h2l2-3h5M8 9h8" />
      </>
    ),
    link: (
      <>
        <path
          d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
          transform="translate(1 0) scale(.9 1)"
        />
      </>
    ),
    palette: (
      <>
        <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.7 1.7 0 0 1 1-3.3h2a4 4 0 0 0 4-4c0-4-4-7-9-7Z" />
        <path d="M7 10h.01M10 6.5h.01M15 7h.01M18 10h.01" strokeWidth="3" />
      </>
    ),
    screen: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="3" />
        <path d="M8 21h8m-4-4v4" />
      </>
    ),
    hide: (
      <>
        <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.5 5.3A12 12 0 0 1 12 5c5 0 9 7 9 7a20 20 0 0 1-3 3.8M6 6.3A23 23 0 0 0 3 12s4 7 9 7a10 10 0 0 0 4.2-1" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function App() {
  const [view, setView] = useState<View>("inbox");
  const [topics, setTopics] = useState<WindChimeAdminTopic[]>([]);
  const [topicListStatus, setTopicListStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [keywordEnabled, setKeywordEnabled] = useState(false);
  const [studioDirty, setStudioDirty] = useState(false),
    [topicDirty, setTopicDirty] = useState(false),
    [settingsDirty, setSettingsDirty] = useState(false);
  const reportError = useCallback((message: string) => setError(message), []);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [label, setLabel] = useState("");
  const [pairing, setPairing] = useState<{
    id: string;
    userCode: string;
    expiresAt: string;
  } | null>(null);
  const [connectionKey, setConnectionKey] = useState("");
  const keyOrigin = useMemo(() => {
    try {
      return parseWindChimeConnectionKey(connectionKey).origin;
    } catch {
      return "";
    }
  }, [connectionKey]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<DesktopStatus>({
    connectionError: "",
    displayOpen: false,
    shortcut: "Ctrl+Shift+H",
    nextShortcut: '', shortcutError: '', nextActionError: '',
    selectedMessageId: null, contextVersion: 0, tiles: [], tile: null,
  });
  const refreshStatus = useCallback(async () => { setStatus(await unwrap(bridge.status())); }, []);
  useEffect(() => { void unwrap(bridge.setTileDirty(studioDirty || topicDirty || settingsDirty)).catch(() => {}); }, [studioDirty, topicDirty, settingsDirty]);
  const selected = sites.find((site) => site.id === selectedId);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const keywordRevision = useRef(0);
  const updateKeyword = useCallback((enabled: boolean) => {
    keywordRevision.current++;
    setKeywordEnabled(enabled);
  }, []);
  const topicId = selected?.selectedTopicId ?? selected?.topicId ?? "";
  const topic = topics.find((item) => item.id === topicId);
  const mailClient = useMemo(
    () =>
      createWindChimeClient({
        baseUrl: "/control",
        fetch: managementFetch(selectedId ?? ""),
      }),
    [selectedId],
  );
  const refresh = useCallback(async () => {
    const result = await unwrap(bridge.sites());
    setSites(result.items);
    setSelectedId(result.selectedId);
  }, []);
  const act = async (operation: () => Promise<unknown>, success = "") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      await refresh();
      if (success) setNotice(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const confirmDiscard = useCallback(
    () => unwrap(bridge.confirm("有尚未保存的修改，放弃修改并继续？")),
    [],
  );
  const change = async (operation: () => Promise<unknown>) => {
    if (
      (studioDirty || topicDirty || settingsDirty) &&
      !(await confirmDiscard())
    )
      return;
    await act(operation);
  };
  const navigate = async (next: View) => {
    if (view === next) return;
    if (
      (studioDirty || topicDirty || settingsDirty) &&
      !(await confirmDiscard())
    )
      return;
    setStudioDirty(false);
    setTopicDirty(false);
    setSettingsDirty(false);
    setView(next);
  };
  const refreshTopics = useCallback(async () => {
    if (!selectedId) return;
    const result = await mailClient.topics.listAdmin({ includeArchived: true });
    if (selectedRef.current === selectedId) setTopics(result.items);
  }, [mailClient, selectedId]);
  useEffect(() => {
    setTopics([]);
    setTopicListStatus("loading");
    setKeywordEnabled(false);
    setStudioDirty(false);
    setTopicDirty(false);
    setSettingsDirty(false);
    if (!selectedId) return;
    let disposed = false;
    let polling = false;
    const abort = new AbortController();
    const load = async () => {
      if (polling || document.visibilityState === "hidden") return;
      polling = true;
      let topicsLoaded = false;
      const keywordVersion = keywordRevision.current;
      try {
        const result = await mailClient.topics.listAdmin({
          includeArchived: true,
          signal: abort.signal,
        });
        if (disposed) return;
        setTopics(result.items);
        setTopicListStatus("ready");
        topicsLoaded = true;
        if (selected?.scope === "site" && !topicId && result.items.length) {
          await unwrap(
            bridge.selectTopic(
              (result.items.find((item) => item.isDefault) ?? result.items[0])
                .id,
              selectedId,
            ),
          );
          if (!disposed) await refresh();
        }
        if (selected?.scope === "site") {
          const settings = await mailClient.request<{
            blockedTermsEnabled?: boolean;
          }>("/settings", "GET", undefined, { signal: abort.signal });
          if (!disposed && keywordVersion === keywordRevision.current)
            setKeywordEnabled(settings.blockedTermsEnabled === true);
        } else if (topicId) {
          const scoped = await mailClient.messages.list({
            topicId,
            signal: abort.signal,
          });
          if (!disposed)
            setKeywordEnabled(
              (scoped as { blockedTermsEnabled?: boolean })
                .blockedTermsEnabled === true,
            );
        }
      } catch (e) {
        if (!disposed) {
          if (!topicsLoaded) setTopicListStatus("error");
          setError(
            e instanceof Error
              ? e.message
              : "无法读取话题，请确认网站已升级风铃 0.7.0",
          );
        }
      } finally {
        polling = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    const wake = () => void load();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    const unsubscribe = mailClient.subscribe(wake);
    return () => {
      disposed = true;
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
      unsubscribe();
    };
  }, [selectedId, topicId, mailClient, refresh]);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const interval = setInterval(() => {
      void unwrap(bridge.status())
        .then(setStatus)
        .catch(() => {});
    }, 1000);
    return () => clearInterval(interval);
  }, [refresh]);
  useEffect(() => {
    if (!pairing) return;
    let disposed = false;
    let polling = false;
    const interval = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await unwrap(bridge.pairingStatus(pairing.id));
        if (!disposed && result.status === "approved") {
          setPairing(null);
          await refresh();
          setNotice("信箱已连接。先打开展示窗口，批准来信后再手动上屏。");
        }
        if (!disposed && result.status === "expired") {
          setPairing(null);
          setError("配对已过期，请重新连接");
        }
      } catch (e) {
        if (!disposed) {
          setPairing(null);
          setError(e instanceof Error ? e.message : "配对失败");
        }
      } finally {
        polling = false;
      }
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [pairing, refresh]);
  const client = useMemo(
    () =>
      createWindChimeLiveClient({
        transport: transport({
          request: async (input) => {
            const result = await bridge.request({
              ...input,
              connectionId: selectedId ?? undefined,
            });
            if (result.ok && input.method !== "GET")
              mailClient.invalidate(["messages", "topics"]);
            return result;
          },
        }),
        assetTransport: assetTransport({
          request: (input) =>
            bridge.request({ ...input, connectionId: selectedId ?? undefined }),
        }),
        uploadTransport: async (_topicId, messageId, file) =>
          unwrap(
            bridge.upload({
              messageId,
              fileName: file.name,
              mimeType: file.type,
              bytes: new Uint8Array(await file.arrayBuffer()),
              connectionId: selectedId ?? undefined,
            }),
          ),
      }),
    [selectedId, topicId, mailClient],
  );
  const pageTitle =
    view === "connections"
      ? "连接你的信箱"
      : view === "settings"
        ? "让来信，有你的风格"
        : view === "topics"
          ? "每场活动，都有自己的话题"
          : view === "share"
            ? "把投稿入口，交给观众"
            : view === "inbox" && selected
              ? "所有来信，在这里慢慢读"
              : selected
                ? "今天，也有值得倾听的声音"
                : "让每一封来信，恰好被听见";
  return (
    <div className="wc-desktop" data-view={view}>
      <style>{windChimeControlCss}</style>
      <div className="desktop-titlebar">
        <span>风铃桌面控制台</span>
        <span className="titlebar-private">
          <Icon name="shield" size={12} /> PRIVATE SPACE
        </span>
      </div>
      <button
        className="desktop-end"
        disabled={!topicId}
        onClick={() =>
          void act(() =>
            client.action({
              topicId,
              action: "end",
              expectedRevision: 0,
              operationId: crypto.randomUUID(),
            }),
          )
        }
      >
        结束展示
      </button>
      <aside className="desktop-sidebar glass-surface">
        <div className="desktop-brand">
          <picture className="brand-mark">
            <source media="(max-width: 960px)" srcSet="brand-symbol.svg" />
            <img
              src="brand-header.svg"
              width={486}
              height={94}
              alt="风铃 WindChime"
            />
          </picture>
        </div>
        <div className="sidebar-label">你的创作空间</div>
        <nav aria-label="桌面导航">
          {(
            [
              ["inbox", "inbox", "收件箱"],
              ["studio", "screen", "直播工作台"],
              ["topics", "inbox", "话题管理"],
              ["share", "link", "投稿分享"],
              ["settings", "palette", "设置与外观"],
              ["connections", "link", "网站连接"],
            ] as const
          ).map(([id, icon, label]) => (
            <button
              key={id}
              aria-label={label}
              title={label}
              aria-current={view === id ? "page" : undefined}
              disabled={id !== "connections" && id !== "inbox" && !selected}
              onClick={() => void navigate(id)}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {view === id ? <i className="nav-dot" /> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="capture-note">
            <Icon name="screen" />
            <div>
              <strong>观众只看到展示窗口</strong>
              <span>采集 WindChime Display</span>
            </div>
          </div>
          <div className="sidebar-signature">
            <span className="quiet-dot" />
            每一封，都由你决定
          </div>
        </div>
      </aside>
      <main className="desktop-main">
        {sites.length > 0 && (
          <section
            className="desktop-context glass-surface"
            aria-label="网站与话题选择"
          >
            <label className="context-field" htmlFor="desktop-mailbox">
              <span>当前网站</span>
              <select
                id="desktop-mailbox"
                value={selectedId ?? ""}
                disabled={busy}
                onChange={(e) => {
                  const nextSiteId = e.target.value;
                  void change(() => unwrap(bridge.selectSite(nextSiteId)));
                }}
              >
                <option value="" disabled>
                  选择网站连接
                </option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.label}
                  </option>
                ))}
              </select>
              {selected && (
                <small title={selected.origin}>
                  {new URL(selected.origin).host}
                </small>
              )}
            </label>
            {selected && (
              <label className="context-field" htmlFor="desktop-topic">
                <span>当前话题</span>
                <select
                  id="desktop-topic"
                  aria-label="当前话题"
                  aria-describedby="desktop-topic-scope"
                  value={topicId}
                  disabled={busy || !topics.length}
                  onChange={(e) => {
                    const nextTopicId = e.target.value;
                    void change(() =>
                      unwrap(bridge.selectTopic(nextTopicId, selected.id)),
                    );
                  }}
                >
                  {!topics.length ? (
                    <option value={topicId} disabled>
                      {topicListStatus === "loading"
                        ? "正在读取话题…"
                        : topicListStatus === "error"
                          ? "读取失败，请检查连接"
                          : "暂无可选话题"}
                    </option>
                  ) : (
                    <>
                      <option value="" disabled>
                        选择话题
                      </option>
                      {topics.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                          {item.archivedAt ? " · 已归档" : ""}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <small id="desktop-topic-scope">
                  {selected.scope === "site"
                    ? "全部话题 · 新活动自动同步"
                    : "仅授权话题 · 切换其他话题需在网页生成站点密钥"}
                </small>
              </label>
            )}
          </section>
        )}
        <header className="desktop-header">
          <div>
            <div className="desktop-eyebrow">
              {
                {
                  studio: "YOUR PRIVATE STUDIO",
                  inbox: "LETTERS FOR YOU",
                  topics: "EVERY OCCASION",
                  share: "SHARE YOUR INBOX",
                  connections: "STAY CONNECTED",
                  settings: "MAKE IT YOURS",
                }[view]
              }
            </div>
            <h1>{pageTitle}</h1>
            <p>
              {
                {
                  studio: "私下审阅，从容安排。准备好了，再交给观众。",
                  inbox: "阅读、收藏和整理来信，决定哪些值得带到直播间。",
                  topics: "安排开放时间，管理当前活动与往期来信。",
                  share: "专属二维码与海报，让观众轻松找到你的信箱。",
                  connections: "一个密钥，把网页里的来信带到桌面。",
                  settings: "管理网站权限与辅助审核，调整你喜欢的展示风格。",
                }[view]
              }
            </p>
          </div>
          <button
            className="desktop-hide"
            title={`立即清空展示窗口（${status.shortcut}）`}
            aria-label="一键隐藏展示"
            onClick={() => void act(() => unwrap(bridge.hide()))}
          >
            <Icon name="hide" />
            <span>
              一键隐藏<kbd>{status.shortcut}</kbd>
            </span>
          </button>
        </header>
        <div className="desktop-alerts wc-live">
          {error ? (
            <p className="wc-error" role="alert">
              {error}
            </p>
          ) : null}
          {status.connectionError ? (
            <p className="wc-error" role="alert">
              {status.connectionError}
            </p>
          ) : null}
          {status.nextActionError ? <p className="wc-error" role="alert">{status.nextActionError}</p> : null}
          {notice ? (
            <p className="wc-notice" role="status">
              {notice}
            </p>
          ) : null}
        </div>
        <section
          className={`desktop-connect ${selected ? "has-connection" : ""}`}
          hidden={!!selected && view !== "connections"}
          aria-label="信箱连接管理"
        >
          {!selected ? (
            <div className="welcome-story">
              <div className="welcome-art" aria-hidden="true">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="floating-letter letter-back">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="floating-letter letter-front">
                  <Icon name="inbox" size={36} />
                  <i />
                  <i />
                </div>
                <div className="welcome-seal">
                  <Icon name="shield" size={24} />
                </div>
              </div>
              <div className="welcome-copy">
                <span className="desktop-eyebrow">
                  A LITTLE SPACE FOR EVERY VOICE
                </span>
                <h2>
                  收好来信，
                  <br />
                  慢慢读。
                </h2>
                <p>
                  让热闹留在直播间，
                  <br />
                  把选择的余地留给自己。
                </p>
              </div>
              <div className="welcome-steps">
                <span>
                  <b>01</b> 私下审阅
                </span>
                <span>
                  <b>02</b> 批准待播
                </span>
                <span>
                  <b>03</b> 手动上屏
                </span>
              </div>
            </div>
          ) : null}
          <div className="connection-card glass-surface wc-live">
            <div className="connection-card-heading">
              <div className="connection-symbol">
                <Icon name="link" size={24} />
              </div>
              <div>
                <h2>{selected ? "添加另一个信箱" : "从连接一个信箱开始"}</h2>
                <p>把网页后台的连接密钥粘贴到这里。</p>
              </div>
            </div>
            <details
              open={!sites.length || view === "connections"}
              className="key-details"
            >
              <summary>连接其他网站与信箱</summary>
              <label>
                连接密钥
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={connectionKey}
                  maxLength={4096}
                  onChange={(e) => setConnectionKey(e.target.value)}
                  placeholder="粘贴网页后台生成的完整连接密钥"
                />
              </label>
              <p className="wc-muted key-help">
                在网站私人后台生成站点连接密钥，复制后即可管理全部话题。
              </p>
              {keyOrigin ? (
                <p className="wc-muted">将连接到：{keyOrigin}</p>
              ) : connectionKey.trim() ? (
                <p className="wc-error" role="alert">
                  密钥格式无效或版本不支持，请复制完整密钥。
                </p>
              ) : null}
              <button
                className="wc-primary connect-submit"
                disabled={busy || !keyOrigin || !!pairing}
                onClick={() => {
                  const submittedKey = connectionKey;
                  void change(async () => {
                    await unwrap(bridge.importKey(submittedKey));
                    setConnectionKey((current) =>
                      current === submittedKey ? "" : current,
                    );
                    setNotice("信箱已连接。打开展示窗口后，仍需手动上屏。");
                  });
                }}
              >
                使用密钥连接
              </button>
              <div className="key-assurance">
                <Icon name="shield" size={15} />
                <span>30 天有效 · 可用于多台电脑 · 随时在网页撤销</span>
              </div>
              <details className="legacy-pairing">
                <summary>备用：旧版浏览器配对</summary>
                <div className="wc-grid2">
                  <label>
                    网站地址
                    <input
                      value={origin}
                      onChange={(e) => setOrigin(e.target.value)}
                      placeholder="https://uliuli.cn"
                    />
                  </label>
                  <label>
                    连接名称
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="例如：UliUli · 常规信箱"
                      maxLength={80}
                    />
                  </label>
                </div>
                <div className="wc-actions" style={{ marginTop: 12 }}>
                  <button
                    className="wc-primary"
                    disabled={busy || !origin || !!pairing}
                    onClick={() =>
                      void change(async () =>
                        setPairing(
                          await unwrap(bridge.pair({ origin, label })),
                        ),
                      )
                    }
                  >
                    在浏览器中登录并授权
                  </button>
                </div>
                {pairing ? (
                  <div className="wc-notice" style={{ marginTop: 12 }}>
                    <strong>设备配对码：{pairing.userCode}</strong>
                    <p>请在已打开的网站后台选择信箱，确认配对码后批准设备。</p>
                    <button
                      style={{ marginTop: 8 }}
                      onClick={() =>
                        void act(async () => {
                          await unwrap(bridge.cancelPairing(pairing.id));
                          setPairing(null);
                        })
                      }
                    >
                      取消配对
                    </button>
                  </div>
                ) : null}
              </details>
            </details>
          </div>
          {selected ? (
            <div className="saved-connection glass-surface">
              <Icon name="shield" size={22} />
              <div>
                <strong>{selected.label}</strong>
                <p>{selected.origin}</p>
                <span>
                  授权到期{" "}
                  {new Date(selected.expiresAt).toLocaleString("zh-CN")}
                </span>
              </div>
              <button
                disabled={busy}
                onClick={() =>
                  void change(() => unwrap(bridge.forgetSite(selected.id)))
                }
              >
                移除此连接
              </button>
            </div>
          ) : null}
        </section>
        {selected ? (
          <>
            <div className="desktop-workspace-bar" hidden={view !== "studio"}>
              <span>
                <Icon name="inbox" size={16} />
                {topic?.title ?? selected.label}
              </span>
              <button
                disabled={busy}
                onClick={() => void act(() => unwrap(bridge.openDisplay()))}
              >
                <Icon name="screen" size={16} />
                {status.displayOpen ? "查看展示窗口" : "打开独立展示窗口"}
                <Icon name="arrow" size={15} />
              </button>
            </div>
            {topicId && (view === "studio" || view === "settings") && (
              <div className="desktop-studio">
                <WindChimeLiveControlPanel
                  key={`${selected.id}:${topicId}:${view}`}
                  client={client}
                  topicId={topicId}
                  title={topic?.title ?? selected.label}
                  canApproveDevices={false}
                  blockedTermsEnabled={keywordEnabled}
                  onDirtyChange={setStudioDirty}
                  onConfirmDiscard={confirmDiscard}
                  onOpenDisplay={() => unwrap(bridge.openDisplay())}
                  onHideDisplay={() => unwrap(bridge.hide())}
                  onOpenTile={view === 'studio' ? module => unwrap(bridge.openTile(module)) : undefined}
                  selectedMessageId={status.selectedMessageId}
                  onSelectMessage={async id => { await unwrap(bridge.selectMessage(id, selected.id, status.contextVersion)); await refreshStatus(); }}
                />
              </div>
            )}
            {topicId && view === "inbox" && (
              <Inbox
                key={`${selected.id}:${topicId}`}
                client={mailClient}
                topicId={topicId}
                siteScope={selected.scope === "site"}
                keywordEnabled={keywordEnabled}
                onError={reportError}
              />
            )}
            {view === "topics" && (
              <Topics
                key={`${selected.id}:${topicId}`}
                client={mailClient}
                siteScope={selected.scope === "site"}
                topics={topics}
                onRefresh={refreshTopics}
                onError={reportError}
                onDirtyChange={setTopicDirty}
              />
            )}
            {topicId && view === "share" && (
              <Share
                key={`${selected.id}:${topicId}`}
                client={mailClient}
                topicId={topicId}
                siteId={selected.siteId}
                onError={reportError}
              />
            )}
            {view === "settings" && (
              <><Hotkeys status={status} onSaved={refreshStatus} /><GlobalSettings
                key={`${selected.id}:${topicId}`}
                client={mailClient}
                siteScope={selected.scope === "site"}
                keywordEnabled={keywordEnabled}
                onKeywordChange={updateKeyword}
                onError={reportError}
                onDirtyChange={setSettingsDirty}
              /></>
            )}
          </>
        ) : null}
        <footer className="desktop-footer">
          <span>WINDCHIME</span>
          <span>风过有声，来信有回响。</span>
        </footer>
      </main>
    </div>
  );
}
const tileModule = WINDCHIME_LIVE_MODULES.find(item => item.id === new URLSearchParams(window.location.search).get('tile'))?.id;
createRoot(document.getElementById("root")!).render(tileModule ? <TileApp module={tileModule} /> : <App />);
