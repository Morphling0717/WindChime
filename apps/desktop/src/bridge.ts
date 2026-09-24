import type {
  WindChimeLiveRequest,
  WindChimeLiveTransport,
} from "../../../src/client/live";
import type { WindChimeLiveModule } from "../../../src/broadcast/ControlPanel";
export type TileInfo = { module: WindChimeLiveModule; pinned: boolean; dirty?: boolean; connectionId: string; topicId: string; contextVersion: number };
export type DesktopStatus = {
  connectionError: string; displayOpen: boolean; shortcut: string;
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
  hide(): Promise<Result<void>>;
  status(): Promise<Result<DesktopStatus>>;
  openTile(module: WindChimeLiveModule): Promise<Result<void>>;
  setTilePinned(module: WindChimeLiveModule, pinned: boolean): Promise<Result<void>>;
  closeTile(module: WindChimeLiveModule): Promise<Result<void>>;
  setTileDirty(dirty: boolean): Promise<Result<void>>;
  selectMessage(id: string | null, connectionId: string, contextVersion?: number): Promise<Result<void>>;
  setNextShortcut(accelerator: string): Promise<Result<void>>;
  setShortcutRecording(recording: boolean): Promise<Result<void>>;
  confirm(message: string): Promise<Result<boolean>>;
  saveFile(input: {
    kind: "png" | "csv";
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
      onBlank(callback: () => void): () => void;
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
