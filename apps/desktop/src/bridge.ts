import type { WindChimeLiveRequest, WindChimeLiveTransport } from '../../../src/client/live';
type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string; status: number };
export type Site = { id: string; label: string; origin: string; siteId: string; topicId: string; expiresAt: string };
type Bridge = {
  sites(): Promise<Result<{ items: Site[]; selectedId: string | null }>>;
  pair(input: { origin: string; label: string }): Promise<Result<{ id: string; userCode: string; expiresAt: string }>>;
  pairingStatus(id: string): Promise<Result<{ status: string; site?: Site }>>;
  cancelPairing(id: string): Promise<Result<void>>;
  selectSite(id: string): Promise<Result<Site>>;
  forgetSite(id: string): Promise<Result<void>>;
  request(input: Omit<WindChimeLiveRequest, 'signal'>): Promise<Result<unknown>>;
  upload(input: { messageId: string; fileName: string; mimeType: string; bytes: Uint8Array }): Promise<Result<{ id: string }>>;
  openDisplay(): Promise<Result<void>>; hide(): Promise<Result<void>>;
  status(): Promise<Result<{ connectionError: string; displayOpen: boolean; shortcut: string }>>;
};
declare global {
  interface Window {
    windchimeDesktop: Bridge;
    windchimeOutput: Pick<Bridge, 'request'> & { onBlank(callback: () => void): () => void };
  }
}
export async function unwrap<T>(result: Promise<Result<T>>): Promise<T> {
  const value = await result; if (value.ok) return value.data;
  const error = new Error(value.error) as Error & { code?: string; status?: number }; error.code = value.code; error.status = value.status; throw error;
}
export function transport(bridge: Pick<Bridge, 'request'>): WindChimeLiveTransport {
  return async <T>({ signal, ...request }: WindChimeLiveRequest) => {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const value = await unwrap(bridge.request(request));
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return value as T;
  };
}
export function assetTransport(bridge: Pick<Bridge, 'request'>) {
  return async (path: string, signal?: AbortSignal) => {
    const result = await transport(bridge)<{ image: string; mimeType: string }>({ path, method: 'GET', signal });
    return new Blob([Uint8Array.from(atob(result.image), character => character.charCodeAt(0))], { type: result.mimeType });
  };
}
