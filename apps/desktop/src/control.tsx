import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createWindChimeLiveClient } from "../../../src/client/live";
import { createWindChimeClient } from "../../../src/client";
import type { WindChimeAdminTopic } from "../../../src/core";
import { WindChimeLiveControlPanel, WINDCHIME_LIVE_MODULES } from "../../../src/broadcast/ControlPanel";
import type {
  WindChimeDisplayScrollCommand,
  WindChimeDisplayScrollMetrics,
} from "../../../src/broadcast/scroll-loop";
import { windChimeControlCss } from "../../../src/broadcast/styles";
import {
  assetTransport,
  transport,
  unwrap,
  managementFetch,
  type Site,
  type DesktopStatus,
  type OnAirInfo,
  type DesktopTheme,
  type DesktopPrefs,
  type DesktopRememberedView,
  type ObsBridgeStatus,
  type DesktopOverlayState,
  type PlayHistoryEntry,
  type TimelineSyncStatus,
  type UpdaterInfo,
} from "./bridge";
import { TileApp } from "./tiles";
import { Hotkeys } from "./Hotkeys";
import { ObsGuidePanel } from "./ObsGuidePanel";
import { LocalOverlaySettings } from "./LocalOverlaySettings";
import { GuideDrawer } from "./GuideDrawer";
import type { GuideJumpTarget } from "./guide-data";
import { playWindChime } from "./chime";
import { Inbox, Topics, Share, GlobalSettings } from "./Management";
import { LiquidGlassDefs } from "./LiquidGlassDefs";
import { useLiquidGlassMotion } from "./liquid-motion";
import { parseWindChimeConnectionKey } from "../../../src/core/connection-key";
import "./glass.css";
import "./management.css";
import "./liquid-glass.css";
import "./guide.css";
const bridge = window.windchimeDesktop;
type View =
  "inbox" | "studio" | "topics" | "share" | "settings" | "connections";
function Icon({
  name,
  size = 20,
}: {
  name: "inbox" | "link" | "palette" | "screen" | "hide" | "shield" | "arrow" | "moon" | "sun" | "book";
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
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
      </>
    ),
    book: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z" />
        <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
        <path d="M9 8h6M9 11.5h4" />
      </>
    ),
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
  const [pairingPaused, setPairingPaused] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<DesktopStatus>({
    connectionError: "",
    displayOpen: false,
    shortcut: "Ctrl+Shift+H",
    nextShortcut: '', shortcutError: '', nextActionError: '',
    selectedMessageId: null, contextVersion: 0, tiles: [], tile: null,
  });
  const [scrollState, setScrollState] = useState<WindChimeDisplayScrollMetrics | null>(null);
  const [spotlightAssetId, setSpotlightAssetId] = useState<string | null>(null);
  const [onAir, setOnAir] = useState<OnAirInfo | null>(null);
  const [theme, setTheme] = useState<DesktopTheme>("light");
  const [prefs, setPrefs] = useState<DesktopPrefs>({
    randomDrawEnabled: false,
    clearOnBlindDraw: false,
    chimeEnabled: false,
    chimeVolume: 70,
    startupView: "last",
    lastView: null,
    autoCheckUpdate: true,
    displayMotion: true,
    uiSurface: "liquid",
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [windowFocused, setWindowFocused] = useState(true);
  const [testCardActive, setTestCardActive] = useState(false);
  const [obsStatus, setObsStatus] = useState<ObsBridgeStatus>({
    enabled: false,
    running: false,
    port: 17420,
    url: "",
    clientCount: 0,
    error: "",
  });
  const [obsGuideOpen, setObsGuideOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [overlay, setOverlay] = useState<DesktopOverlayState>({
    enabled: false,
    badgeUrl: null,
    badgePosition: "top-right",
    badgeSize: 64,
    badgeOpacity: 90,
    watermarkText: "",
    backgroundUrl: null,
    backgroundOpacity: 35,
    hasBadge: false,
    hasBackground: false,
    version: 0,
  });
  const [history, setHistory] = useState<PlayHistoryEntry[]>([]);
  const [streamStartedAt, setStreamStartedAt] = useState<string | null>(null);
  const [timelineStatus, setTimelineStatus] = useState<TimelineSyncStatus | null>(null);
  const [updaterInfo, setUpdaterInfo] = useState<UpdaterInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateNotesOpen, setUpdateNotesOpen] = useState(false);
  const [expiryDismissedId, setExpiryDismissedId] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const prevPendingRef = useRef<{ topicKey: string; count: number } | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const userNavigatedRef = useRef(false);
  const startupAppliedRef = useRef(false);
  const [settingsTab, setSettingsTab] = useState<"appearance" | "controls" | "safety" | "grants">("appearance");
  const [studioMode, setStudioMode] = useState<"blindbox" | "workbench">("blindbox");
  useEffect(() => {
    void unwrap(bridge.getScrollState()).then(setScrollState).catch(() => {});
    return bridge.onScrollState(setScrollState);
  }, []);
  useEffect(() => {
    void unwrap(bridge.getSpotlight()).then(setSpotlightAssetId).catch(() => {});
    return bridge.onSpotlightChanged(setSpotlightAssetId);
  }, []);
  useEffect(() => {
    void unwrap(bridge.getOnAir()).then(setOnAir).catch(() => {});
    return bridge.onOnAir(setOnAir);
  }, []);
  useEffect(() => {
    void unwrap(bridge.getTheme()).then(setTheme).catch(() => {});
    return bridge.onThemeChanged(setTheme);
  }, []);
  useEffect(() => {
    void unwrap(bridge.getPrefs())
      .then((value) => {
        setPrefs(value);
        setPrefsLoaded(true);
      })
      .catch(() => setPrefsLoaded(true));
    return bridge.onPrefsChanged(setPrefs);
  }, []);
  useEffect(() => {
    void unwrap(bridge.getTestCard()).then(setTestCardActive).catch(() => {});
    return bridge.onTestCardChanged(setTestCardActive);
  }, []);
  useEffect(() => {
    void unwrap(bridge.getObsStatus()).then(setObsStatus).catch(() => {});
    return bridge.onObsStatusChanged(setObsStatus);
  }, []);
  useEffect(() => {
    void unwrap(bridge.getOverlay()).then(setOverlay).catch(() => {});
    return bridge.onOverlayChanged(setOverlay);
  }, []);
  useEffect(() => {
    void unwrap(bridge.getHistory()).then(setHistory).catch(() => {});
    return bridge.onHistoryChanged(setHistory);
  }, []);
  useEffect(() => {
    void unwrap(bridge.getStreamStartedAt()).then(setStreamStartedAt).catch(() => {});
    return bridge.onStreamStartChanged(setStreamStartedAt);
  }, []);
  useEffect(() => {
    void unwrap(bridge.getTimelineStatus()).then(setTimelineStatus).catch(() => {});
    return bridge.onTimelineStatusChanged(setTimelineStatus);
  }, []);
  useEffect(() => {
    void unwrap(bridge.getUpdaterInfo()).then(setUpdaterInfo).catch(() => {});
    return bridge.onUpdaterChanged((info) => {
      setUpdaterInfo(info);
      if (info.stage === "downloading" || info.stage === "ready") {
        setUpdateDismissed(false);
      }
    });
  }, []);
  useEffect(() => {
    if (!prefsLoaded || !prefs.autoCheckUpdate) return;
    const runCheck = () => {
      void unwrap(bridge.checkUpdate())
        .then((info) => {
          if (!info.error) setUpdaterInfo(info);
        })
        .catch(() => {});
    };
    const timer = setTimeout(runCheck, 5000);
    const periodic = setInterval(runCheck, 4 * 60 * 60 * 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(periodic);
    };
  }, [prefsLoaded, prefs.autoCheckUpdate]);
  useEffect(() => {
    void unwrap(bridge.getWindowFocus()).then(setWindowFocused).catch(() => {});
    return bridge.onWindowFocus(setWindowFocused);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.uiSurface = prefs.uiSurface;
    document.documentElement.dataset.acrylic = prefs.acrylicActive ? "1" : "0";
    document.documentElement.dataset.windowFocused = windowFocused ? "1" : "0";
  }, [prefs.uiSurface, prefs.acrylicActive, windowFocused]);
  useLiquidGlassMotion(rootRef, prefs.uiSurface === "liquid");
  const toggleTheme = () => {
    const next: DesktopTheme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    void unwrap(bridge.setTheme(next)).catch(() => {});
  };
  const pollErrorActiveRef = useRef(false);
  const updatePrefs = useCallback(async (patch: Partial<DesktopPrefs>) => {
    const previous = prefsRef.current;
    setPrefs(current => ({ ...current, ...patch }));
    try {
      const saved = await unwrap(bridge.setPrefs(patch));
      setPrefs(saved);
    } catch (e) {
      setPrefs(previous);
      throw e;
    }
  }, []);
  const manualCheckUpdate = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    setError("");
    try {
      const info = await unwrap(bridge.checkUpdate());
      setUpdaterInfo(info);
      setUpdateDismissed(false);
      if (info.error) setError(info.error);
      else if (info.hasUpdate) setNotice(info.canDownload ? `发现新版本 v${info.latestVersion}（已通过签名校验），可在顶部横幅一键应用内更新。` : `发现新版本 v${info.latestVersion}，可在顶部横幅一键前往下载。`);
      else setNotice(`当前已是最新版本 v${info.currentVersion}。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "检查更新失败");
    } finally {
      setCheckingUpdate(false);
    }
  };
  const startUpdateDownload = async () => {
    setError("");
    try {
      const info = await unwrap(bridge.downloadUpdate());
      setUpdaterInfo(info);
      if (info.stage === "ready") {
        setNotice(`新版 v${info.latestVersion} 已下载并校验通过，随时可点击「立即安装并重启」。`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载更新失败");
    }
  };
  const cancelUpdateDownload = async () => {
    try {
      await unwrap(bridge.cancelUpdateDownload());
    } catch {}
  };
  const installDownloadedUpdate = async () => {
    setError("");
    const liveActive = Boolean(onAir || status.displayOpen || obsStatus.clientCount > 0);
    const prompt = liveActive
      ? "检测到当前展示端在线或正在播出。点击「继续」将先清空观众画面、退出风铃并启动新版安装向导（不会丢失已有密钥和设置）。确定现在安装？"
      : "即将退出风铃并启动新版安装向导覆盖升级，已有网站密钥、热键和本地配置会完整保留。继续？";
    if (!(await unwrap(bridge.confirm(prompt)))) return;
    try {
      await unwrap(bridge.installUpdate());
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动更新安装程序失败");
    }
  };
  const exportPlayHistory = useCallback(async (format: "md" | "csv" | "chapters") => {
    setError("");
    try {
      const saved = await unwrap(bridge.exportHistory({ format }));
      if (saved) {
        setNotice(
          format === "chapters"
            ? "已导出 B站 / 录播切片章节 TXT。"
            : format === "md"
              ? "已导出 Markdown 播报复盘清单。"
              : "已导出 CSV 播报复盘表格。",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出播报复盘失败");
    }
  }, []);
  const updateStreamStartedAt = useCallback(async (iso: string | null) => {
    setError("");
    try {
      const saved = await unwrap(bridge.setStreamStartedAt(iso));
      setStreamStartedAt(saved);
      setNotice(saved ? `已标记开播基准时间（${new Date(saved).toLocaleTimeString("zh-CN", { hour12: false })}），复盘记录将自动换算录播时间轴。` : "已清除开播时间标记。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "设置开播时间失败");
    }
  }, []);
  const updateTimelineOffset = useCallback(async (sec: number) => {
    setError("");
    try {
      await unwrap(bridge.setTimelineOffset(sec));
    } catch (e) {
      setError(e instanceof Error ? e.message : "设置时间轴偏移失败");
    }
  }, []);
  const syncTimelineTrack = useCallback(async (track?: "stream" | "record" | "bilibili") => {
    setError("");
    try {
      const next = await unwrap(bridge.syncTimelineNow({ track, forceApply: true }));
      setTimelineStatus(next);
      const hasAutoLive = Boolean(
        next.obsWs.streamActive ||
        next.obsWs.recordActive ||
        next.obsLog.streamActive ||
        next.obsLog.recordActive ||
        next.bilibili.live,
      );
      if (hasAutoLive && next.anchor.startedAt) {
        setStreamStartedAt(next.anchor.startedAt);
        setNotice(`已同步开播时间轴：${next.anchor.label || "自动基准"}（${new Date(next.anchor.startedAt).toLocaleTimeString("zh-CN", { hour12: false })}）。`);
      } else if (next.anchor.startedAt && next.anchor.source === "manual") {
        setNotice("尚未检测到活动中的 OBS 推流/录制或 B站直播间，已保留你的手动开播时间标记。");
      } else {
        setNotice("尚未检测到活动中的 OBS 推流/录制或已配置的 B站直播间，可在「设置 → 播控与热键」填入房间号或手动标记。");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步开播时间轴失败");
    }
  }, []);
  const pickRecordingFileForTimeline = useCallback(async () => {
    setError("");
    try {
      const res = await unwrap(bridge.pickRecordingForTimeline());
      if (!res) return;
      setTimelineStatus(res.status);
      setStreamStartedAt(res.startedAt);
      if (res.warning) {
        setError(res.warning);
      } else {
        setNotice(`已按录播文件「${res.fileName}」创建时间（${new Date(res.startedAt).toLocaleTimeString("zh-CN", { hour12: false })}）对齐整场时间轴。`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取录播文件时间失败");
    }
  }, []);
  const copyHistoryChapters = useCallback(async () => {
    setError("");
    try {
      const text = await unwrap(bridge.getHistoryChapters());
      if (!text.trim()) {
        setError("暂无可导出的本场播报记录。");
        return false;
      }
      await unwrap(bridge.writeClipboard(text));
      setNotice("已复制 B站视频分段章节到剪贴板，可直接粘贴到 B站简介或评论区时间轴。");
      return true;
    } catch {
      setError("复制到剪贴板失败，可使用「导出章节 TXT」保存。");
      return false;
    }
  }, []);
  const clearPlayHistory = useCallback(async () => {
    if (!(await unwrap(bridge.confirm("确定清空本机保存的全部直播上屏复盘记录？网站原信不受影响。")))) return;
    setError("");
    try {
      const next = await unwrap(bridge.clearHistory());
      setHistory(next);
      setNotice("已清空本机播报复盘记录。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "清空复盘记录失败");
    }
  }, []);
  const toggleTestCard = useCallback(async (active: boolean) => {
    setError("");
    try {
      const next = await unwrap(bridge.setTestCard(active));
      setTestCardActive(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法切换对位测试卡");
    }
  }, []);
  const scrollDisplay = useCallback(
    (command: WindChimeDisplayScrollCommand) => unwrap(bridge.scrollDisplay(command)),
    [],
  );
  const toggleSpotlight = useCallback(async (assetId: string | null) => {
    const next = await unwrap(bridge.setSpotlight(assetId));
    setSpotlightAssetId(next);
  }, []);
  const refreshStatus = useCallback(async () => { setStatus(await unwrap(bridge.status())); }, []);
  useEffect(() => {
    void unwrap(
      bridge.setTileDirty({
        review: view === "studio" && studioDirty,
        other: (view === "settings" && studioDirty) || topicDirty || settingsDirty,
      }),
    ).catch(() => {});
  }, [view, studioDirty, topicDirty, settingsDirty]);
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
    const [result, currentStatus] = await Promise.all([
      unwrap(bridge.sites()),
      unwrap(bridge.status()),
    ]);
    setSites(result.items);
    setSelectedId(result.selectedId);
    setStatus(currentStatus);
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
    await act(async () => {
      // The main process checks all private windows once, at commit time.
      await unwrap(
        bridge.setTileDirty({
          review: view === "studio" && studioDirty,
          other: (view === "settings" && studioDirty) || topicDirty || settingsDirty,
        }),
      );
      await operation();
    });
  };
  const navigate = async (next: View) => {
    if (view === next) return;
    if (
      (studioDirty || topicDirty || settingsDirty) &&
      !(await confirmDiscard())
    )
      return;
    userNavigatedRef.current = true;
    setError("");
    setNotice("");
    setStudioDirty(false);
    setTopicDirty(false);
    setSettingsDirty(false);
    setView(next);
    if (next !== "connections") {
      void updatePrefs({ lastView: next as DesktopRememberedView }).catch(() => {});
    }
  };
  const handleGuideJump = useCallback(async (target: GuideJumpTarget) => {
    if (!selected) return;
    if (view !== target.view) {
      if ((studioDirty || topicDirty || settingsDirty) && !(await confirmDiscard())) return;
      userNavigatedRef.current = true;
      setError("");
      setNotice("");
      setStudioDirty(false);
      setTopicDirty(false);
      setSettingsDirty(false);
      setView(target.view);
      void updatePrefs({ lastView: target.view as DesktopRememberedView }).catch(() => {});
    }
    if (target.view === "studio") {
      if (target.studioMode) setStudioMode(target.studioMode);
      if (target.openObsGuide) setObsGuideOpen(true);
    } else if (target.view === "settings") {
      setSettingsTab(target.settingsTab);
    }
  }, [selected, view, studioDirty, topicDirty, settingsDirty, confirmDiscard, updatePrefs]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F1" || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (status.shortcutRecording) return;
      event.preventDefault();
      setGuideOpen(open => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [status.shortcutRecording]);
  useEffect(() => {
    if (startupAppliedRef.current || userNavigatedRef.current || !prefsLoaded || !selectedId) return;
    startupAppliedRef.current = true;
    const target: View =
      prefs.startupView === "studio"
        ? "studio"
        : prefs.startupView === "inbox"
          ? "inbox"
          : prefs.lastView ?? "inbox";
    if (target !== "inbox") setView(target);
  }, [prefsLoaded, selectedId, prefs.startupView, prefs.lastView]);
  const reportPendingCount = useCallback(
    (count: number) => {
      const topicKey = `${selectedId ?? ""}:${topicId}`;
      const prev = prevPendingRef.current;
      if (prev && prev.topicKey === topicKey && count > prev.count && prefsRef.current.chimeEnabled) {
        playWindChime(prefsRef.current.chimeVolume);
      }
      prevPendingRef.current = { topicKey, count };
      setPendingCount(count);
      void unwrap(bridge.updateBadge(count)).catch(() => {});
    },
    [selectedId, topicId],
  );
  useEffect(() => {
    prevPendingRef.current = null;
    setPendingCount(0);
    void unwrap(bridge.updateBadge(0)).catch(() => {});
  }, [selectedId, topicId]);
  useEffect(() => {
    if (!selectedId || !topicId || view === "studio") return;
    let disposed = false;
    let inflight = false;
    const pollPending = async () => {
      if (inflight || disposed) return;
      inflight = true;
      try {
        const res = await unwrap(
          bridge.request({
            path: `/control/state?topicId=${encodeURIComponent(topicId)}`,
            method: "GET",
            connectionId: selectedId,
          }),
        ) as { messages?: Array<{ status?: string }> };
        if (!disposed && Array.isArray(res?.messages)) {
          reportPendingCount(res.messages.filter((m) => m.status === "pending").length);
        }
      } catch {
      } finally {
        inflight = false;
      }
    };
    const timer = setInterval(() => void pollPending(), 8000);
    const initial = setTimeout(() => void pollPending(), 1200);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearTimeout(initial);
    };
  }, [selectedId, topicId, view, reportPendingCount]);
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
        if (pollErrorActiveRef.current) {
          pollErrorActiveRef.current = false;
          setError("");
        }
        const activeMissing = !topicId || !result.items.some((item) => item.id === topicId);
        if (selected?.scope === "site" && activeMissing && result.items.length) {
          const fallbackTopic =
            result.items.find((item) => item.isDefault && !item.archivedAt) ??
            result.items.find((item) => !item.archivedAt) ??
            result.items[0];
          await unwrap(bridge.selectTopic(fallbackTopic.id, selectedId));
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
          pollErrorActiveRef.current = true;
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
    if (!pairing || pairingPaused) return;
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
          setPairingPaused(true);
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
  }, [pairing, pairingPaused, refresh]);
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
  const pageTitle = {
    connections: "网站连接",
    settings: "设置与外观",
    topics: "话题管理",
    share: "投稿分享",
    inbox: "收件箱",
    studio: "直播工作台",
  }[view];
  return (
    <div
      ref={rootRef}
      className="wc-desktop"
      data-view={view}
      data-theme={theme}
      data-ui-surface={prefs.uiSurface}
      data-acrylic={prefs.acrylicActive ? "1" : "0"}
      data-window-focused={windowFocused ? "1" : "0"}
    >
      <LiquidGlassDefs enabled={prefs.uiSurface === "liquid"} />
      <style>{windChimeControlCss}</style>
      <div className="desktop-titlebar">
        <span>风铃桌面控制台</span>
        <span className="titlebar-private">
          <Icon name="shield" size={12} /> 私人控制台
        </span>
        {onAir ? (
          <button
            type="button"
            className="titlebar-onair is-live"
            title={`正在播出：${onAir.nickname || "匿名来信"} — ${onAir.textPreview}（点击前往直播工作台）`}
            onClick={() => void navigate("studio")}
          >
            <i className="titlebar-onair-dot" aria-hidden="true" />
            <span>正在播出：{onAir.nickname || onAir.textPreview || "已批准信件"}</span>
          </button>
        ) : testCardActive ? (
          <button
            type="button"
            className="titlebar-onair is-live"
            title="展示窗口正在显示 OBS 对位测试卡（点击关闭）"
            onClick={() => void toggleTestCard(false).catch(() => {})}
          >
            <i className="titlebar-onair-dot" aria-hidden="true" />
            <span>OBS 测试卡对位中 · 点击关闭</span>
          </button>
        ) : selected ? (
          <span
            className="titlebar-onair is-blank"
            title={
              obsStatus.clientCount > 0
                ? `OBS 浏览器源已连接（${obsStatus.clientCount}），当前画面为空白`
                : status.displayOpen
                  ? "展示窗口已打开，当前画面为空白"
                  : "尚未打开展示窗口或连接 OBS 浏览器源"
            }
          >
            <i className="titlebar-onair-dot" aria-hidden="true" />
            <span>{status.displayOpen || obsStatus.clientCount > 0 ? "画面为空白" : "未开展示窗"}</span>
          </span>
        ) : null}
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
              aria-label={id === "studio" && pendingCount > 0 ? `${label}（待拆 ${pendingCount} 封）` : label}
              title={id === "studio" && pendingCount > 0 ? `${label}（待拆 ${pendingCount} 封）` : label}
              data-badge={id === "studio" && pendingCount > 0 ? (pendingCount > 99 ? "99+" : String(pendingCount)) : undefined}
              aria-current={view === id ? "page" : undefined}
              disabled={id !== "connections" && !selected}
              onClick={() => void navigate(id)}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {view === id && !(id === "studio" && pendingCount > 0) ? (
                <i className="nav-dot" />
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            type="button"
            className="sidebar-guide-btn"
            aria-label="打开风铃使用指南"
            title="风铃使用指南（F1）"
            onClick={() => setGuideOpen(true)}
          >
            <Icon name="book" size={16} />
            <span>使用指南</span>
            <kbd className="guide-btn-kbd">F1</kbd>
          </button>
          <button
            type="button"
            className="sidebar-theme-toggle"
            aria-label={theme === "dark" ? "切换浅色外观" : "切换深色外观"}
            title={theme === "dark" ? "切换浅色外观" : "切换深色外观"}
            onClick={toggleTheme}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
            <span>{theme === "dark" ? "浅色模式" : "夜间模式"}</span>
          </button>
          <div className="sidebar-version-row">
            <span>{`v${status.version || updaterInfo?.currentVersion || "1.4.0"}`}</span>
            <button
              type="button"
              className={`sidebar-update-btn${updaterInfo?.hasUpdate ? " has-update" : ""}`}
              disabled={checkingUpdate}
              onClick={() => {
                if (updaterInfo?.stage === "ready") {
                  setUpdateDismissed(false);
                  return;
                }
                void manualCheckUpdate();
              }}
            >
              {checkingUpdate
                ? "检查中…"
                : updaterInfo?.stage === "ready"
                  ? "待安装"
                  : updaterInfo?.stage === "downloading"
                    ? `${updaterInfo.percent}%`
                    : updaterInfo?.hasUpdate
                      ? `新版 v${updaterInfo.latestVersion}`
                      : "检查更新"}
            </button>
          </div>
          <div className="capture-note">
            <Icon name="screen" />
            <div>
              <strong>观众只看到展示端</strong>
              <span>{obsStatus.clientCount > 0 ? `OBS 浏览器源已连 ${obsStatus.clientCount}` : "采集 WindChime Display / OBS"}</span>
            </div>
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
            <h1>{pageTitle}</h1>
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
          {selected && Number.isFinite(Date.parse(selected.expiresAt)) && (Date.parse(selected.expiresAt) - Date.now()) / 3600000 <= 72 && expiryDismissedId !== selected.id ? (
            <div className="desktop-banner is-warn" role="status">
              <span>
                {Date.parse(selected.expiresAt) <= Date.now()
                  ? `当前网站「${selected.label}」的连接密钥已过期，请重新生成并导入。`
                  : `当前网站「${selected.label}」的连接密钥将于 ${Math.max(1, Math.ceil((Date.parse(selected.expiresAt) - Date.now()) / 3600000))} 小时后到期，建议提前更换避免开播断联。`}
              </span>
              <div className="desktop-banner-actions">
                <button type="button" onClick={() => void navigate("connections")}>前往更换密钥</button>
                <button type="button" className="wc-subtle" onClick={() => setExpiryDismissedId(selected.id)}>知道了</button>
              </div>
            </div>
          ) : null}
          {updaterInfo?.hasUpdate && !updateDismissed ? (
            <div className="desktop-banner is-update update-banner-stack" role="status">
              <div className="update-banner-top">
                <div className="update-banner-meta">
                  <strong>{`发现新版本 v${updaterInfo.latestVersion}`}</strong>
                  {updaterInfo.verified ? <span className="update-verified-pill">国内直连 · 已验签</span> : null}
                  <span>{updaterInfo.title && updaterInfo.title !== `v${updaterInfo.latestVersion}` ? updaterInfo.title : "绝不打断当前直播"}</span>
                </div>
                <div className="desktop-banner-actions">
                  {updaterInfo.notes ? (
                    <button type="button" className="wc-subtle" onClick={() => setUpdateNotesOpen(v => !v)}>
                      {updateNotesOpen ? "收起更新内容" : "查看更新内容"}
                    </button>
                  ) : null}
                  {updaterInfo.stage === "downloading" ? (
                    <button type="button" className="wc-subtle" onClick={() => void cancelUpdateDownload()}>
                      取消下载
                    </button>
                  ) : updaterInfo.stage === "verifying" ? (
                    <button type="button" disabled>正在校验 SHA-256…</button>
                  ) : updaterInfo.stage === "ready" ? (
                    <button type="button" className="wc-primary" onClick={() => void installDownloadedUpdate()}>
                      立即安装并重启
                    </button>
                  ) : updaterInfo.canDownload ? (
                    <button type="button" className="wc-primary" onClick={() => void startUpdateDownload()}>
                      {updaterInfo.installerSize > 0
                        ? `一键下载更新（${(updaterInfo.installerSize / (1024 * 1024)).toFixed(1)} MB）`
                        : "一键下载更新"}
                    </button>
                  ) : null}
                  {updaterInfo.stage !== "downloading" && updaterInfo.stage !== "verifying" ? (
                    <>
                      <button type="button" onClick={() => void unwrap(bridge.openRelease(updaterInfo.url)).catch(() => {})}>
                        GitHub 页面
                      </button>
                      <button type="button" className="wc-subtle" onClick={() => setUpdateDismissed(true)}>稍后</button>
                    </>
                  ) : null}
                </div>
              </div>
              {updaterInfo.stage === "downloading" || updaterInfo.stage === "verifying" ? (
                <div className="update-progress-wrap">
                  <div className="update-progress-track">
                    <div className="update-progress-fill" style={{ width: `${updaterInfo.stage === "verifying" ? 100 : updaterInfo.percent}%` }} />
                  </div>
                  <span className="update-progress-text">
                    {updaterInfo.stage === "verifying"
                      ? "下载完成，正在核对 SHA-256 完整性…"
                      : `${updaterInfo.percent}% · ${(updaterInfo.downloadedBytes / (1024 * 1024)).toFixed(1)} / ${(updaterInfo.totalBytes / (1024 * 1024)).toFixed(1)} MB${updaterInfo.speedBytesPerSec > 0 ? ` · ${(updaterInfo.speedBytesPerSec / (1024 * 1024)).toFixed(2)} MB/s` : ""}`}
                  </span>
                </div>
              ) : null}
              {updaterInfo.stage === "ready" ? (
                <p className="update-ready-note">安装包已下载并通过 Ed25519 + SHA-256 双重安全校验，下播后随时点击「立即安装并重启」即可覆盖升级。</p>
              ) : null}
              {updateNotesOpen && updaterInfo.notes ? (
                <pre className="update-notes-box">{updaterInfo.notes}</pre>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <div className="wc-error desktop-alert-row" role="alert">
              <span>{error}</span>
              <button type="button" className="desktop-alert-close" aria-label="关闭错误提示" onClick={() => setError("")}>×</button>
            </div>
          ) : null}
          {status.connectionError ? (
            <p className="wc-error" role="alert">
              {status.connectionError}
            </p>
          ) : null}
          {status.nextActionError ? <p className="wc-error" role="alert">{status.nextActionError}</p> : null}
          {notice ? (
            <div className="wc-notice desktop-alert-row" role="status">
              <span>{notice}</span>
              <button type="button" className="desktop-alert-close" aria-label="关闭通知" onClick={() => setNotice("")}>×</button>
            </div>
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
                <h2>桌面控制台</h2>
                <p>信箱管理、审核与直播展示</p>
              </div>
              <div className="welcome-steps">
                <span>
                  <b>01</b> 审阅
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
                <h2>{selected ? "添加连接" : "连接网站"}</h2>
                <p>粘贴网页后台生成的连接密钥。</p>
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
                      void change(async () => {
                        setPairingPaused(false);
                        setPairing(
                          await unwrap(bridge.pair({ origin, label })),
                        );
                      })
                    }
                  >
                    在浏览器中登录并授权
                  </button>
                </div>
                {pairing ? (
                  <div className="wc-notice" style={{ marginTop: 12 }}>
                    <strong>设备配对码：{pairing.userCode}</strong>
                    <p>请在已打开的网站后台选择信箱，确认配对码后批准设备。</p>
                    {pairingPaused ? <button onClick={() => { setError(""); setPairingPaused(false); }}>重试连接</button> : null}
                    <button
                      style={{ marginTop: 8 }}
                      onClick={() =>
                        void act(async () => {
                          const result = await unwrap(bridge.cancelPairing(pairing.id));
                          setPairing(null);
                          if (result.connected) setNotice("连接已经保存，当前信箱已同步；可以在网站连接中移除此连接。");
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
                  void (async () => {
                    if (
                      await unwrap(
                        bridge.confirm(
                          `确定移除网站「${selected.label}」的连接？本机保存的连接密钥将被清除，展示窗口将立即清空。`,
                        ),
                      )
                    ) {
                      await change(() => unwrap(bridge.forgetSite(selected.id)));
                    }
                  })()
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
              <div className="wc-actions">
                <button
                  type="button"
                  onClick={() => setObsGuideOpen(open => !open)}
                >
                  {obsStatus.clientCount > 0
                    ? `OBS 浏览器源 · 已连 ${obsStatus.clientCount}`
                    : obsStatus.running
                      ? "OBS 浏览器源 · 待机"
                      : "OBS 采集设置"}
                </button>
                <button
                  disabled={busy || Boolean(onAir && !testCardActive)}
                  onClick={() => void toggleTestCard(!testCardActive).catch(() => {})}
                >
                  {testCardActive ? "关闭测试卡" : "测试卡对位 OBS"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => void act(() => unwrap(bridge.openDisplay()))}
                >
                  <Icon name="screen" size={16} />
                  {status.displayOpen ? "查看展示窗口" : "打开独立展示窗口"}
                  <Icon name="arrow" size={15} />
                </button>
              </div>
            </div>
            {view === "studio" && obsGuideOpen ? (
              <div style={{ marginBottom: 16 }}>
                <ObsGuidePanel
                  obsStatus={obsStatus}
                  displayOpen={status.displayOpen}
                  testCardActive={testCardActive}
                  onAir={Boolean(onAir)}
                  onToggleTestCard={toggleTestCard}
                  onOpenDisplay={() => act(() => unwrap(bridge.openDisplay()))}
                  onObsChanged={setObsStatus}
                  onClose={() => setObsGuideOpen(false)}
                />
              </div>
            ) : null}
            {view === "settings" && (
              <nav className="settings-tabs glass-surface" role="tablist" aria-label="设置分类">
                {(
                  [
                    ["appearance", "展示外观"],
                    ["controls", "播控与热键"],
                    ["safety", "安全与屏蔽"],
                    ["grants", "连接授权"],
                  ] as const
                ).map(([tabId, tabLabel]) => (
                  <button
                    key={tabId}
                    type="button"
                    role="tab"
                    aria-selected={settingsTab === tabId}
                    onClick={() => setSettingsTab(tabId)}
                  >
                    {tabLabel}
                  </button>
                ))}
              </nav>
            )}
            {(view === "studio" || view === "settings") && (
              <div
                className="desktop-studio"
                hidden={view === "settings" && settingsTab !== "appearance"}
              >
                {view === "settings" && (
                  <div className="desktop-workspace-bar" style={{ marginBottom: 14 }}>
                    <span>调整外观后可在展示窗发送测试卡实时对位 OBS。</span>
                    <div className="wc-actions">
                      <button
                        disabled={busy || Boolean(onAir && !testCardActive)}
                        onClick={() => void toggleTestCard(!testCardActive).catch(() => {})}
                      >
                        {testCardActive ? "关闭测试卡" : "发测试卡对位 OBS"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void act(() => unwrap(bridge.openDisplay()))}
                      >
                        <Icon name="screen" size={16} />
                        {status.displayOpen ? "查看展示窗口" : "打开独立展示窗口"}
                      </button>
                    </div>
                  </div>
                )}
                {topicId ? (
                  <WindChimeLiveControlPanel
                    key={`${selected.id}:${topicId}:${view}`}
                    client={client}
                    topicId={topicId}
                    title={topic?.title ?? selected.label}
                    module={view === "settings" ? "appearance" : undefined}
                    hideSettingsSection={view === "studio"}
                    canApproveDevices={false}
                    blockedTermsEnabled={keywordEnabled}
                    onDirtyChange={setStudioDirty}
                    onConfirmDiscard={confirmDiscard}
                    onOpenDisplay={() => unwrap(bridge.openDisplay())}
                    onHideDisplay={() => unwrap(bridge.hide())}
                    onOpenTile={view === 'studio' ? module => unwrap(bridge.openTile(module)) : undefined}
                    selectedMessageId={view === "studio" ? status.selectedMessageId : undefined}
                    onSelectMessage={view === "studio" ? async id => { await unwrap(bridge.selectMessage(id, selected.id, status.contextVersion)); await refreshStatus(); } : undefined}
                    scrollState={view === "studio" ? scrollState : undefined}
                    onScrollDisplay={view === "studio" ? scrollDisplay : undefined}
                    spotlightAssetId={view === "studio" ? spotlightAssetId : undefined}
                    onToggleSpotlight={view === "studio" ? toggleSpotlight : undefined}
                    defaultStudioMode={view === "studio" ? "blindbox" : undefined}
                    studioMode={view === "studio" ? studioMode : undefined}
                    onStudioModeChange={view === "studio" ? setStudioMode : undefined}
                    collapsibleReviewEditor={view === "studio"}
                    testCardActive={testCardActive}
                    onToggleTestCard={toggleTestCard}
                    randomDrawEnabled={prefs.randomDrawEnabled}
                    clearOnBlindDraw={prefs.clearOnBlindDraw}
                    onToggleClearOnBlindDraw={enabled => void updatePrefs({ clearOnBlindDraw: enabled }).catch(() => {})}
                    localOverlay={overlay}
                    obsClientCount={obsStatus.clientCount}
                    onOpenObsGuide={view === "studio" ? () => setObsGuideOpen(true) : undefined}
                    onPendingCountChange={view === "studio" ? reportPendingCount : undefined}
                    sessionHistory={view === "studio" ? history : undefined}
                    streamStartedAt={view === "studio" ? streamStartedAt : undefined}
                    timelineInfo={
                      view === "studio" && timelineStatus
                        ? {
                            anchorStartedAt: timelineStatus.anchor.startedAt,
                            anchorSource: timelineStatus.anchor.source,
                            anchorLabel: timelineStatus.anchor.label,
                            offsetSec: timelineStatus.anchor.offsetSec,
                            activeLive: Boolean(
                              timelineStatus.obsWs.streamActive ||
                              timelineStatus.obsWs.recordActive ||
                              timelineStatus.obsLog.streamActive ||
                              timelineStatus.obsLog.recordActive ||
                              timelineStatus.bilibili.live,
                            ),
                            streamTrack: timelineStatus.tracks.stream,
                            recordTrack: timelineStatus.tracks.record,
                            bilibiliTrack: timelineStatus.tracks.bilibili,
                          }
                        : undefined
                    }
                    onSetStreamStartedAt={view === "studio" ? updateStreamStartedAt : undefined}
                    onSetTimelineOffset={view === "studio" ? updateTimelineOffset : undefined}
                    onSyncTimeline={view === "studio" ? syncTimelineTrack : undefined}
                    onPickRecordingFile={view === "studio" ? pickRecordingFileForTimeline : undefined}
                    onCopyChapters={view === "studio" ? copyHistoryChapters : undefined}
                    onExportHistory={view === "studio" ? exportPlayHistory : undefined}
                    onClearHistory={view === "studio" ? clearPlayHistory : undefined}
                    onBlockMessage={
                      view === "studio" && selected.scope === "site"
                        ? async messageId => {
                            if (!(await unwrap(bridge.confirm("在整个网站屏蔽此发送者并处理其来信？对应展示会同步撤下。")))) {
                              return false;
                            }
                            await mailClient.messages.block(messageId, { topicId });
                            return true;
                          }
                        : undefined
                    }
                  />
                ) : (
                  <div className="glass-surface management settings-card">
                    <p className="empty-copy">
                      {topicListStatus === "loading"
                        ? "正在同步网站话题列表…"
                        : "当前尚未连接到可用话题，请检查网站连接或前往「网站连接」更新密钥。"}
                    </p>
                  </div>
                )}
                {view === "settings" ? (
                  <div style={{ marginTop: 18 }}>
                    <LocalOverlaySettings overlay={overlay} onChange={setOverlay} />
                  </div>
                ) : null}
              </div>
            )}
            {view === "inbox" && (
              topicId ? (
                <Inbox
                  key={`${selected.id}:${topicId}`}
                  client={mailClient}
                  liveClient={client}
                  topicId={topicId}
                  siteScope={selected.scope === "site"}
                  keywordEnabled={keywordEnabled}
                  onError={reportError}
                  onNotice={setNotice}
                />
              ) : (
                <div className="glass-surface management settings-card">
                  <p className="empty-copy">
                    {topicListStatus === "loading"
                      ? "正在同步网站话题与收件箱…"
                      : "暂时无法读取话题列表，请检查网站连接或前往「网站连接」更换密钥。"}
                  </p>
                </div>
              )
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
            {view === "share" && (
              topicId ? (
                <Share
                  key={`${selected.id}:${topicId}`}
                  client={mailClient}
                  topicId={topicId}
                  siteId={selected.siteId}
                  onError={reportError}
                  onNotice={setNotice}
                />
              ) : (
                <div className="glass-surface management settings-card">
                  <p className="empty-copy">
                    {topicListStatus === "loading"
                      ? "正在同步话题分享配置…"
                      : "请先连接可用网站与话题后再生成投稿二维码与海报。"}
                  </p>
                </div>
              )
            )}
            {view === "settings" && (
              <>
                <div hidden={settingsTab !== "controls"} className="desktop-controls-stack">
                  <ObsGuidePanel
                    obsStatus={obsStatus}
                    displayOpen={status.displayOpen}
                    testCardActive={testCardActive}
                    onAir={Boolean(onAir)}
                    onToggleTestCard={toggleTestCard}
                    onOpenDisplay={() => act(() => unwrap(bridge.openDisplay()))}
                    onObsChanged={setObsStatus}
                  />
                  <Hotkeys
                    status={status}
                    onSaved={refreshStatus}
                    prefs={prefs}
                    onUpdatePrefs={updatePrefs}
                    timelineStatus={timelineStatus}
                    onTimelineChange={setTimelineStatus}
                  />
                </div>
                <div hidden={settingsTab !== "safety" && settingsTab !== "grants"} className="wc-live">
                  <GlobalSettings
                    key={`${selected.id}:${topicId}`}
                    client={mailClient}
                    siteScope={selected.scope === "site"}
                    keywordEnabled={keywordEnabled}
                    onKeywordChange={updateKeyword}
                    onError={reportError}
                    onDirtyChange={setSettingsDirty}
                    section={settingsTab === "grants" ? "grants" : "safety"}
                  />
                </div>
              </>
            )}
          </>
        ) : null}
      </main>
      <GuideDrawer
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        onJump={handleGuideJump}
        hasSite={Boolean(selected)}
        theme={theme}
        uiSurface={prefs.uiSurface}
      />
    </div>
  );
}
const tileModule = WINDCHIME_LIVE_MODULES.find(item => item.id === new URLSearchParams(window.location.search).get('tile'))?.id;
createRoot(document.getElementById("root")!).render(tileModule ? <TileApp module={tileModule} /> : <App />);
