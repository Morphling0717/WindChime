import type {
  WindChimeLiveRequest,
  WindChimeLiveTransport,
} from "../../../src/client/live";
import type { WindChimeLiveModule } from "../../../src/broadcast/ControlPanel";
import type { WindChimeLocalOverlay } from "../../../src/broadcast/Display";
import type {
  WindChimeDisplayScrollCommand,
  WindChimeDisplayScrollMetrics,
} from "../../../src/broadcast/scroll-loop";
export type ScrollShortcuts = {
  up: string;
  down: string;
  pause: string;
  error?: string;
};
export type OnAirInfo = {
  messageId: string;
  snapshotId: string;
  nickname: string | null;
  textPreview: string;
};
export type DesktopTheme = "light" | "dark";
export type DesktopUiSurface = "liquid" | "standard" | "lite";
export type DesktopStartupView = "inbox" | "studio" | "last";
export type DesktopRememberedView = "inbox" | "studio" | "topics" | "share" | "settings";
export type DesktopPrefs = {
  randomDrawEnabled: boolean;
  clearOnBlindDraw: boolean;
  chimeEnabled: boolean;
  chimeVolume: number;
  startupView: DesktopStartupView;
  lastView: DesktopRememberedView | null;
  autoCheckUpdate: boolean;
  uiSurface: DesktopUiSurface;
  acrylicActive?: boolean;
};
export type ObsBridgeStatus = {
  enabled: boolean;
  running: boolean;
  port: number;
  url: string;
  clientCount: number;
  error: string;
};
export type DesktopOverlayState = WindChimeLocalOverlay & {
  hasBadge: boolean;
  hasBackground: boolean;
  version: number;
};
export type PlayHistoryEntry = {
  id: string;
  snapshotId: string;
  messageId: string;
  playedAt: string;
  dateKey: string;
  siteLabel: string;
  topicTitle: string;
  nickname: string | null;
  textSnippet: string;
  assetCount: number;
};
export type UpdaterInfo = {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  verified: boolean;
  canDownload: boolean;
  source: string;
  stage: "idle" | "checking" | "available" | "downloading" | "verifying" | "ready" | "error";
  title: string;
  notes: string;
  url: string;
  publishedAt: string;
  checkedAt: string;
  error: string;
  installerFileName: string;
  installerSize: number;
  installerSha256: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  speedBytesPerSec: number;
};
export type TileInfo = { module: WindChimeLiveModule; pinned: boolean; dirty?: boolean; connectionId: string; topicId: string; contextVersion: number };
export type DesktopStatus = {
  version?: string;
  connectionError: string; displayOpen: boolean; obsRunning?: boolean; obsClients?: number; shortcut: string;
  nextShortcut: string; shortcutError: string; nextActionError: string;
  selectedMessageId: string | null; contextVersion: number;
  tiles: TileInfo[]; tile: TileInfo | null;
};
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; status: number };
export type Site = {
  id: string;
  label: string;
  origin: string;
  siteId: string;
  topicId: string | null;
  scope?: "site" | "topic";
  selectedTopicId?: string | null;
  mailManagement?: boolean;
  expiresAt: string;
};
type PrivateRequest = {
  path: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  connectionId?: string;
};
type Bridge = {
  sites(): Promise<Result<{ items: Site[]; selectedId: string | null }>>;
  importKey(key: string): Promise<Result<Site>>;
  pair(input: {
    origin: string;
    label: string;
  }): Promise<Result<{ id: string; userCode: string; expiresAt: string }>>;
  pairingStatus(id: string): Promise<Result<{ status: string; site?: Site }>>;
  cancelPairing(id: string): Promise<Result<{ connected: boolean }>>;
  selectSite(id: string): Promise<Result<Site>>;
  selectTopic(id: string, connectionId: string): Promise<Result<Site>>;
  forgetSite(id: string): Promise<Result<void>>;
  request(input: PrivateRequest): Promise<Result<unknown>>;
  upload(input: {
    messageId: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    connectionId?: string;
  }): Promise<Result<{ id: string }>>;
  openDisplay(): Promise<Result<void>>;
  scrollDisplay(command: WindChimeDisplayScrollCommand): Promise<Result<void>>;
  getScrollState(): Promise<Result<WindChimeDisplayScrollMetrics | null>>;
  onScrollState(callback: (state: WindChimeDisplayScrollMetrics | null) => void): () => void;
  getOnAir(): Promise<Result<OnAirInfo | null>>;
  onOnAir(callback: (state: OnAirInfo | null) => void): () => void;
  getTheme(): Promise<Result<DesktopTheme>>;
  setTheme(theme: DesktopTheme): Promise<Result<DesktopTheme>>;
  onThemeChanged(callback: (theme: DesktopTheme) => void): () => void;
  getPrefs(): Promise<Result<DesktopPrefs>>;
  setPrefs(patch: Partial<DesktopPrefs>): Promise<Result<DesktopPrefs>>;
  onPrefsChanged(callback: (prefs: DesktopPrefs) => void): () => void;
  updateBadge(count: number): Promise<Result<number>>;
  getTestCard(): Promise<Result<boolean>>;
  setTestCard(active: boolean): Promise<Result<boolean>>;
  onTestCardChanged(callback: (active: boolean) => void): () => void;
  getObsStatus(): Promise<Result<ObsBridgeStatus>>;
  configureObs(patch: { enabled?: boolean; port?: number }): Promise<Result<ObsBridgeStatus>>;
  resetObsKey(): Promise<Result<ObsBridgeStatus>>;
  onObsStatusChanged(callback: (status: ObsBridgeStatus) => void): () => void;
  getOverlay(): Promise<Result<DesktopOverlayState>>;
  setOverlay(patch: Partial<WindChimeLocalOverlay>): Promise<Result<DesktopOverlayState>>;
  pickOverlayImage(slot: "badge" | "background"): Promise<Result<DesktopOverlayState | null>>;
  clearOverlayImage(slot: "badge" | "background"): Promise<Result<DesktopOverlayState>>;
  onOverlayChanged(callback: (overlay: DesktopOverlayState) => void): () => void;
  getHistory(): Promise<Result<PlayHistoryEntry[]>>;
  exportHistory(input?: { format?: "md" | "csv"; dateKey?: string }): Promise<Result<boolean>>;
  clearHistory(): Promise<Result<PlayHistoryEntry[]>>;
  onHistoryChanged(callback: (entries: PlayHistoryEntry[]) => void): () => void;
  getUpdaterInfo(): Promise<Result<UpdaterInfo>>;
  checkUpdate(): Promise<Result<UpdaterInfo>>;
  downloadUpdate(): Promise<Result<UpdaterInfo>>;
  cancelUpdateDownload(): Promise<Result<boolean>>;
  installUpdate(): Promise<Result<boolean>>;
  openRelease(url?: string): Promise<Result<boolean>>;
  onUpdaterChanged(callback: (info: UpdaterInfo) => void): () => void;
  hide(): Promise<Result<void>>;
  status(): Promise<Result<DesktopStatus>>;
  openTile(module: WindChimeLiveModule): Promise<Result<void>>;
  setTilePinned(module: WindChimeLiveModule, pinned: boolean): Promise<Result<void>>;
  closeTile(module: WindChimeLiveModule): Promise<Result<void>>;
  setTileDirty(dirty: boolean | { review: boolean; other: boolean }): Promise<Result<void>>;
  selectMessage(id: string | null, connectionId: string, contextVersion?: number): Promise<Result<void>>;
  setNextShortcut(accelerator: string): Promise<Result<void>>;
  getScrollShortcuts(): Promise<Result<ScrollShortcuts>>;
  setScrollShortcuts(input: { up?: string; down?: string; pause?: string }): Promise<Result<ScrollShortcuts>>;
  setShortcutRecording(recording: boolean): Promise<Result<void>>;
  confirm(message: string): Promise<Result<boolean>>;
  saveFile(input: {
    kind: "png" | "csv" | "md";
    name: string;
    content?: string;
    bytes?: Uint8Array;
  }): Promise<Result<boolean>>;
  chooseAvatar(): Promise<Result<{ image: string; mimeType: string } | null>>;
  openSubmission(): Promise<Result<boolean>>;
};
declare global {
  interface Window {
    windchimeDesktop: Bridge;
    windchimeOutput: Pick<Bridge, "request"> & {
      getOverlay(): Promise<Result<DesktopOverlayState>>;
      onBlank(callback: () => void): () => void;
      onScrollCommand(callback: (command: WindChimeDisplayScrollCommand) => void): () => void;
      onTestCard(callback: (payload: { active: boolean; appearance: unknown }) => void): () => void;
      onOverlay(callback: (overlay: DesktopOverlayState) => void): () => void;
      reportScroll(metrics: WindChimeDisplayScrollMetrics | null): void;
    };
  }
}
export async function unwrap<T>(result: Promise<Result<T>>): Promise<T> {
  const value = await result;
  if (value.ok === true) return value.data;
  const error = new Error(value.error) as Error & {
    code?: string;
    status?: number;
  };
  error.code = value.code;
  error.status = value.status;
  throw error;
}
export function shortcutLabel(value: string) { return value.replace(/CommandOrControl|Control/g, 'Ctrl').replace(/Super/g, 'Win'); }
export function transport(
  bridge: Pick<Bridge, "request">,
): WindChimeLiveTransport {
  return async <T>({ signal, ...request }: WindChimeLiveRequest) => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const value = await unwrap(bridge.request(request));
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return value as T;
  };
}
export function assetTransport(bridge: Pick<Bridge, "request">) {
  return async (path: string, signal?: AbortSignal) => {
    const result = await transport(bridge)<{ image: string; mimeType: string }>(
      { path, method: "GET", signal },
    );
    return new Blob(
      [
        Uint8Array.from(atob(result.image), (character) =>
          character.charCodeAt(0),
        ),
      ],
      { type: result.mimeType },
    );
  };
}
/** Existing shared mailbox client uses this adapter; no network or credentials enter the renderer. */
export function managementFetch(connectionId: string): typeof fetch {
  return async (input, init: RequestInit = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!url.startsWith("/control/")) throw new Error("不允许此资源");
    if (init.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const result = await window.windchimeDesktop.request({
      path: url,
      method: (init.method ?? "GET") as PrivateRequest["method"],
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      connectionId,
    });
    if (init.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return new Response(
      JSON.stringify(
        result.ok === true
          ? result.data
          : { error: result.error, code: result.code },
      ),
      {
        status: result.ok === true ? 200 : result.status || 400,
        headers: { "content-type": "application/json" },
      },
    );
  };
}
