import type { WindChimeLiveAction, WindChimeLiveControlState, WindChimeLiveFrame, WindChimeLiveGrant, WindChimeShareInfo } from '../core/live.js';
import type { WindChimeConnectionIdentity } from '../core/connection-key.js';
import type { WindChimeAdminTopic, WindChimeMessageList, WindChimeMessageRecord, WindChimeBlockedSender, WindChimeInboxFilter } from '../core/index.js';
import type { WindChimeTopicCreateInput, WindChimeTopicPatchInput } from '../types-topics.js';

export type WindChimeLiveCapabilities = {
  protocolVersion: number; siteId: string; basePath: string;
  features: { connectionKeys?: boolean; images?: boolean; pairing?: boolean; broadcast?: boolean; siteControl?: boolean; mailManagement?: boolean; keywordFilterToggle?: boolean; displayThemes?: boolean };
  pollIntervalMs: number; leaseMs: number;
};
export type { WindChimeConnectionIdentity } from '../core/connection-key.js';

/** A desktop may inject this restricted transport without exposing credentials. */
export type WindChimeLiveRequest = { path: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal };
export type WindChimeLiveTransport = <T>(request: WindChimeLiveRequest) => Promise<T>;
export type WindChimeLiveOptions = {
  baseUrl?: string; getHeaders?: () => HeadersInit | Promise<HeadersInit>;
  fetch?: typeof globalThis.fetch; transport?: WindChimeLiveTransport;
  assetTransport?: (path: string, signal?: AbortSignal) => Promise<Blob>;
  uploadTransport?: (topicId: string, messageId: string, file: File) => Promise<{ id: string }>;
};
export class WindChimeLiveClientError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); this.name = 'WindChimeLiveClientError'; }
}
function makeTransport(options: WindChimeLiveOptions, credentials: RequestCredentials) {
  const base = (options.baseUrl ?? '/api/mail/live').replace(/\/$/, '');
  async function response(path: string, method: string, body: unknown, signal?: AbortSignal) {
    const headers = new Headers(await options.getHeaders?.());
    if (body !== undefined) headers.set('content-type', 'application/json');
    const result = await (options.fetch ?? globalThis.fetch)(`${base}${path}`, {
      method, body: body === undefined ? undefined : JSON.stringify(body), headers,
      credentials, cache: 'no-store', redirect: 'error', signal,
    });
    if (!result.ok) {
      const data = await result.json().catch(() => ({})) as { code?: string; error?: string };
      throw new WindChimeLiveClientError(data.code ?? 'REQUEST_FAILED', result.status, data.error ?? '连接失败，请重新连接信箱');
    }
    return result;
  }
  const request: WindChimeLiveTransport = options.transport ?? (async <T>({ path, method, body, signal }: WindChimeLiveRequest) => {
    const result = await response(path, method, body, signal);
    return await result.json() as T;
  });
  const asset = options.assetTransport ?? (async (path: string, signal?: AbortSignal) => (await response(path, 'GET', undefined, signal)).blob());
  return { request, asset };
}
const scope = (topicId: string) => `topicId=${encodeURIComponent(topicId)}`;
export function createWindChimeLiveClient(options: WindChimeLiveOptions = {}) {
  const { request, asset } = makeTransport(options, 'same-origin');
  return {
    capabilities: (signal?: AbortSignal) => request<WindChimeLiveCapabilities>({ path: '/capabilities', method: 'GET', signal }),
    /** The server accepts only a control Bearer grant here, never an admin cookie. */
    identity: (signal?: AbortSignal) => request<WindChimeConnectionIdentity>({ path: '/control/identity', method: 'GET', signal }),
    state: (topicId: string, signal?: AbortSignal) => request<WindChimeLiveControlState>({ path: `/control/state?${scope(topicId)}`, method: 'GET', signal }),
    action: (body: WindChimeLiveAction) => request<WindChimeLiveControlState>({ path: '/control/action', method: 'POST', body }),
    message: (topicId: string, messageId: string, patch: { isRead?: boolean; isFavorited?: boolean }) => request<WindChimeLiveControlState>({ path: '/control/message', method: 'POST', body: { topicId, messageId, ...patch } }),
    grants: (topicId?: string) => request<{ items: WindChimeLiveGrant[] }>({ path: '/control/grants'+(topicId === undefined ? '' : `?${scope(topicId)}`), method: 'GET' }),
    createGrant: (topicId: string, kind: 'display' | 'control', label = '') => request<{ id: string; token: string; expiresAt: string; topicId: string; kind: string }>({ path: '/control/grants', method: 'POST', body: { topicId, kind, label } }),
    createSiteGrant: (label = '') => request<{ id: string; token: string; expiresAt: string; topicId: null; scope: 'site'; kind: 'control' }>({ path: '/control/grants', method: 'POST', body: { kind: 'control', scope: 'site', label } }),
    revokeGrant: (topicId: string | undefined, id: string) => request<unknown>({ path: `/control/grants/${encodeURIComponent(id)}`+(topicId === undefined ? '' : `?${scope(topicId)}`), method: 'DELETE' }),
    topics: {
      list: (includeArchived = false, signal?: AbortSignal) => request<{items:WindChimeAdminTopic[]}>({path:'/control/topics'+(includeArchived?'?include=archived':''),method:'GET',signal}),
      get: (id:string) => request<WindChimeAdminTopic>({path:`/control/topics/${encodeURIComponent(id)}`,method:'GET'}),
      create: (input:WindChimeTopicCreateInput) => request<WindChimeAdminTopic>({path:'/control/topics',method:'POST',body:input}),
      update: (id:string,input:WindChimeTopicPatchInput) => request<WindChimeAdminTopic>({path:`/control/topics/${encodeURIComponent(id)}`,method:'PATCH',body:input}),
      archive: (id:string,markReadFirst=false) => request<{topic:WindChimeAdminTopic;unreadCount:number;flaggedCount:number}>({path:`/control/topics/${encodeURIComponent(id)}/archive`,method:'POST',body:{markReadFirst}}),
      restore: (id:string) => request<WindChimeAdminTopic>({path:`/control/topics/${encodeURIComponent(id)}/restore`,method:'POST',body:{}}),
      purge: (id:string) => request<{ok:true;topic:WindChimeAdminTopic}>({path:`/control/topics/${encodeURIComponent(id)}/purge`,method:'DELETE'}),
    },
    messages: {
      list: (topicId:string,filter:WindChimeInboxFilter='all',signal?:AbortSignal) => request<WindChimeMessageList>({path:`/control/messages?${scope(topicId)}&filter=${filter}`,method:'GET',signal}),
      get: (topicId:string,id:string) => request<WindChimeMessageRecord>({path:`/control/messages/${encodeURIComponent(id)}?${scope(topicId)}`,method:'GET'}),
      update: (topicId:string,id:string,patch:{isRead?:boolean;isFavorited?:boolean;isFlagged?:boolean}) => request<{ok:true}>({path:`/control/messages/${encodeURIComponent(id)}?${scope(topicId)}`,method:'PATCH',body:patch}),
      delete: (topicId:string,id:string) => request<{ok:true}>({path:`/control/messages/${encodeURIComponent(id)}?${scope(topicId)}`,method:'DELETE'}),
      batch: (topicId:string,action:'delete'|'markRead',ids:string[]) => request<{ok:true}>({path:`/control/messages/batch?${scope(topicId)}`,method:'POST',body:{action,ids}}),
      block: (topicId:string,id:string) => request<{ok:true}>({path:`/control/messages/${encodeURIComponent(id)}/block?${scope(topicId)}`,method:'POST',body:{}}),
    },
    settings: {
      get: (signal?:AbortSignal) => request<{enabled:boolean;blockedTermsEnabled:boolean}>({path:'/control/settings',method:'GET',signal}),
      setEnabled: (enabled:boolean) => request<{enabled:boolean}>({path:'/control/settings',method:'PUT',body:{enabled}}),
      setBlockedTermsEnabled: (blockedTermsEnabled:boolean) => request<{enabled:boolean;blockedTermsEnabled:boolean}>({path:'/control/settings',method:'PATCH',body:{blockedTermsEnabled}}),
    },
    blockedTerms: {
      get: () => request<{terms:string[]}>({path:'/control/blocked-terms',method:'GET'}),
      set: (terms:string[]) => request<{terms:string[]}>({path:'/control/blocked-terms',method:'PUT',body:{terms}}),
    },
    blocklist: {
      list: () => request<WindChimeBlockedSender[]>({path:'/control/blocklist',method:'GET'}),
      remove: (hash:string) => request<{ok:true}>({path:`/control/blocklist/${encodeURIComponent(hash)}`,method:'DELETE'}),
    },
    share: (topicId:string) => request<WindChimeShareInfo>({path:`/control/share?${scope(topicId)}`,method:'GET'}),
    approveDevice: (userCode: string, topicId: string) => request<{ ok: true }>({ path: '/devices/approve', method: 'POST', body: { userCode, topicId } }),
    bindingChallenge: (topicId: string) => request<{ nonce: string; siteId: string; topicId: string; siteOrigin: string; expiresAt: string }>({ path: '/control/binding-challenge', method: 'POST', body: { topicId } }),
    bind: (topicId: string, proof: string) => request<{ ok: true; bindingId: string }>({ path: '/control/bind', method: 'POST', body: { topicId, proof } }),
    unbind: (topicId: string) => request<unknown>({ path: `/control/bind?${scope(topicId)}`, method: 'DELETE' }),
    asset: (topicId: string, id: string, signal?: AbortSignal) => asset(`/control/assets/${encodeURIComponent(id)}?${scope(topicId)}`, signal),
    upload: async (topicId: string, messageId: string, file: File): Promise<{ id: string }> => {
      if (options.uploadTransport) return options.uploadTransport(topicId, messageId, file);
      const form = new FormData(); form.set('topicId', topicId); form.set('messageId', messageId); form.set('file', file);
      const headers = new Headers(await options.getHeaders?.());
      const result = await (options.fetch ?? globalThis.fetch)(`${(options.baseUrl ?? '/api/mail/live').replace(/\/$/, '')}/control/upload`, { method: 'POST', body: form, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      const body = await result.json();
      if (!result.ok) throw new WindChimeLiveClientError(body.code ?? 'UPLOAD_FAILED', result.status, body.error ?? '图片上传失败');
      return body.attachments?.[0] ?? body;
    },
  };
}
export type WindChimeLiveClient = ReturnType<typeof createWindChimeLiveClient>;
export type WindChimeDisplayOpen = { receiverId: string; epoch: string; leaseMs: number; pollIntervalMs: number };
/** This factory intentionally omits all administrative capabilities and cookies. */
export function createWindChimeDisplayClient(options: WindChimeLiveOptions & { token?: string } = {}) {
  const { request, asset } = makeTransport({ ...options, getHeaders: async () => {
    const headers = new Headers(await options.getHeaders?.());
    if (options.token) headers.set('authorization', `Bearer ${options.token}`);
    return headers;
  } }, 'omit');
  return {
    open: (signal?: AbortSignal) => request<WindChimeDisplayOpen>({ path: '/display/open', method: 'POST', body: {}, signal }),
    frame: (receiverId: string, signal?: AbortSignal) => request<WindChimeLiveFrame>({ path: `/display/frame?receiverId=${encodeURIComponent(receiverId)}`, method: 'GET', signal }),
    asset: (id: string, receiverId: string, activation: number, signal?: AbortSignal) => asset(`/display/assets/${encodeURIComponent(id)}?receiverId=${encodeURIComponent(receiverId)}&activation=${activation}`, signal),
  };
}
export type WindChimeDisplayClient = ReturnType<typeof createWindChimeDisplayClient>;
