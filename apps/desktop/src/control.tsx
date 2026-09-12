import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createWindChimeLiveClient } from "../../../src/client/live";
import { WindChimeLiveControlPanel } from "../../../src/broadcast/ControlPanel";
import { windChimeControlCss } from "../../../src/broadcast/styles";
import { assetTransport, transport, unwrap, type Site } from "./bridge";
import { parseWindChimeConnectionKey } from "../../../src/core/connection-key";
import "./glass.css";
const bridge = window.windchimeDesktop;
type View = "studio" | "connections" | "appearance";
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
  const [view, setView] = useState<View>("studio");
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
  const [status, setStatus] = useState({
    connectionError: "",
    displayOpen: false,
    shortcut: "Ctrl+Shift+H",
  });
  const selected = sites.find((site) => site.id === selectedId);
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
        transport: transport(bridge),
        assetTransport: assetTransport(bridge),
        uploadTransport: async (_topicId, messageId, file) =>
          unwrap(
            bridge.upload({
              messageId,
              fileName: file.name,
              mimeType: file.type,
              bytes: new Uint8Array(await file.arrayBuffer()),
            }),
          ),
      }),
    [selectedId],
  );
  const pageTitle =
    view === "connections"
      ? "连接你的信箱"
      : view === "appearance"
        ? "让来信，有你的风格"
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
              ["studio", "inbox", "来信工作台"],
              ["connections", "link", "信箱连接"],
              ["appearance", "palette", "展示外观"],
            ] as const
          ).map(([id, icon, label]) => (
            <button
              key={id}
              aria-label={label}
              title={label}
              aria-current={view === id ? "page" : undefined}
              disabled={id === "appearance" && !selected}
              onClick={() => setView(id)}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {view === id ? <i className="nav-dot" /> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-mailbox">
          <div className="sidebar-label">当前信箱</div>
          <label className="sr-only" htmlFor="desktop-mailbox">
            当前信箱
          </label>
          <select
            id="desktop-mailbox"
            value={selectedId ?? ""}
            disabled={busy || !sites.length}
            onChange={(e) =>
              void act(() => unwrap(bridge.selectSite(e.target.value)))
            }
          >
            <option value="" disabled>
              尚未连接信箱
            </option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.label}
              </option>
            ))}
          </select>
          {selected ? (
            <span className="sidebar-origin">
              {new URL(selected.origin).host}
            </span>
          ) : (
            <span className="sidebar-origin">从网页复制密钥，即可连接</span>
          )}
        </div>
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
        {selected ? (
          <label className="mobile-mailbox">
            当前信箱
            <select
              aria-label="窄窗口切换信箱"
              value={selectedId ?? ""}
              disabled={busy}
              onChange={(e) =>
                void act(() => unwrap(bridge.selectSite(e.target.value)))
              }
            >
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <header className="desktop-header">
          <div>
            <div className="desktop-eyebrow">
              {view === "studio"
                ? "YOUR PRIVATE STUDIO"
                : view === "connections"
                  ? "STAY CONNECTED"
                  : "MAKE IT YOURS"}
            </div>
            <h1>{pageTitle}</h1>
            <p>
              {view === "studio"
                ? "私下审阅，从容安排。准备好了，再交给观众。"
                : view === "connections"
                  ? "一个密钥，把网页里的来信带到桌面。"
                  : "在私下预览中调整，选择适合这场直播的表达。"}
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
                在网站私人后台选择话题，生成并复制完整密钥。
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
                  void act(async () => {
                    await unwrap(bridge.importKey(submittedKey));
                    setConnectionKey((current) =>
                      current === submittedKey ? "" : current,
                    );
                  }, "信箱已连接。打开展示窗口后，仍需手动上屏。");
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
                      void act(async () =>
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
                  void act(
                    () => unwrap(bridge.forgetSite(selected.id)),
                    "已从此电脑移除连接；可在网站管理设备授权",
                  )
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
                {selected.label}
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
            <div className="desktop-studio">
              <WindChimeLiveControlPanel
                key={selected.id}
                client={client}
                topicId={selected.topicId}
                title={selected.label}
                canApproveDevices={false}
                onOpenDisplay={() => unwrap(bridge.openDisplay())}
              />
            </div>
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
createRoot(document.getElementById("root")!).render(<App />);
