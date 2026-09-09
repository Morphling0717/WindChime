import type {
  WindChimeMessageRecord,
  WindChimeSubmitPayload,
  WindChimeInboxFilter,
  WindChimeBlockedSender,
  WindChimeTopic,
  WindChimeTopicCreateInput,
  WindChimeTopicPatchInput,
  WindChimeTopicArchiveResponse,
  WindChimePublicTopic,
  WindChimeAdminTopic,
} from "../core/index.js";
import { WindChimeError, toWindChimePublicTopic } from "../core/index.js";
export type { WindChimeCounts, WindChimeMessageList } from "../core/index.js";
import type { WindChimeMessageList } from "../core/index.js";
export { windChimeMessagesToCsv, downloadWindChimeCsv } from "./csv.js";
import { windChimeMessagesToCsv } from "./csv.js";

export class WindChimeClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
    message = code,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "WindChimeClientError";
  }
}
export function asWindChimeClientError(error: unknown): WindChimeClientError {
  return error instanceof WindChimeClientError
    ? error
    : error instanceof WindChimeError
      ? new WindChimeClientError(
          error.code,
          error.status,
          error.message,
          error.retryAfterMs,
        )
      : new WindChimeClientError(
          error instanceof Error && error.name === "AbortError"
            ? "ABORTED"
            : "REQUEST_FAILED",
          0,
          error instanceof Error ? error.message : "REQUEST_FAILED",
        );
}
export type WindChimeClientOptions = {
  baseUrl?: string;
  /** Optional full resource URLs for existing route layouts. */
  endpoints?: Partial<Record<WindChimeResource, string>>;
  fetch?: typeof globalThis.fetch;
  getHeaders?: () => HeadersInit | Promise<HeadersInit>;
  credentials?: RequestCredentials;
};
export type WindChimeRequestOptions = {
  signal?: AbortSignal;
  topicId?: string;
};
export type WindChimeMessagePatch = {
  isRead?: boolean;
  isFavorited?: boolean;
  isFlagged?: boolean;
};
export type WindChimeResource =
  "messages" | "topics" | "settings" | "blockedTerms" | "blocklist";
export type WindChimeChangeListener = (
  resources: readonly WindChimeResource[],
) => void;

export function createWindChimeClient(options: WindChimeClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? "/api/mail").replace(/\/$/, "");
  const listeners = new Set<WindChimeChangeListener>();
  const invalidate = (resources: readonly WindChimeResource[]) => {
    for (const listener of listeners) listener(resources);
  };
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    opts: WindChimeRequestOptions = {},
  ): Promise<T> {
    const query = new URLSearchParams();
    if (opts.topicId) query.set("topicId", opts.topicId);
    const resourcePaths: Record<WindChimeResource, string> = {
      messages: "/messages",
      topics: "/topics",
      settings: "/settings",
      blockedTerms: "/blocked-terms",
      blocklist: "/blocklist",
    };
    let target = `${baseUrl}${path}`;
    for (const [resource, prefix] of Object.entries(resourcePaths)) {
      const replacement = options.endpoints?.[resource as WindChimeResource];
      if (
        replacement &&
        (path === prefix ||
          path.startsWith(`${prefix}/`) ||
          path.startsWith(`${prefix}?`))
      ) {
        const suffix = path.slice(prefix.length);
        const [endpointPath, endpointQuery = ""] = replacement.split("?");
        const [suffixPath, suffixQuery = ""] = suffix.split("?");
        const mergedQuery = new URLSearchParams(endpointQuery);
        new URLSearchParams(suffixQuery).forEach((value, key) =>
          mergedQuery.set(key, value),
        );
        target = `${endpointPath!.replace(/\/$/, "")}${suffixPath}${mergedQuery.size ? `?${mergedQuery}` : ""}`;
        break;
      }
    }
    const url = `${target}${query.size ? `${target.includes("?") ? "&" : "?"}${query}` : ""}`;
    const headers = new Headers(await options.getHeaders?.());
    if (body !== undefined) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await (options.fetch ?? globalThis.fetch)(url, {
        method,
        headers,
        credentials: options.credentials ?? "same-origin",
        cache: "no-store",
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (error) {
      throw asWindChimeClientError(error);
    }
    let data: unknown;
    const raw = await response.text();
    try {
      data = raw ? JSON.parse(raw) : undefined;
    } catch {
      if (response.ok)
        throw new WindChimeClientError("INVALID_RESPONSE", response.status);
    }
    if (!response.ok) {
      const failure = (data && typeof data === "object" ? data : {}) as {
        code?: string;
        error?: string;
        retryAfterMs?: number;
      };
      const seconds = Number(response.headers.get("Retry-After"));
      throw new WindChimeClientError(
        failure.code ?? `HTTP_${response.status}`,
        response.status,
        failure.error ?? `HTTP_${response.status}`,
        failure.retryAfterMs ?? (seconds > 0 ? seconds * 1000 : undefined),
      );
    }
    return data as T;
  }
  async function mutate<T>(
    resources: readonly WindChimeResource[],
    path: string,
    method: string,
    body?: unknown,
    opts?: WindChimeRequestOptions,
  ) {
    const result = await request<T>(path, method, body, opts);
    invalidate(resources);
    return result;
  }
  const messageChanges: WindChimeResource[] = ["messages", "topics"];
  return {
    subscribe(listener: WindChimeChangeListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    invalidate,
    request,
    messages: {
      list: (
        opts: WindChimeRequestOptions & { filter?: WindChimeInboxFilter } = {},
      ) =>
        request<WindChimeMessageList>(
          `/messages?filter=${opts.filter ?? "all"}`,
          "GET",
          undefined,
          opts,
        ),
      submit: (
        payload: WindChimeSubmitPayload,
        opts?: Pick<WindChimeRequestOptions, "signal">,
      ) =>
        mutate<{ ok: true }>(
          messageChanges,
          "/messages",
          "POST",
          payload,
          opts,
        ),
      detail: (id: string, opts?: WindChimeRequestOptions) =>
        request<WindChimeMessageRecord>(
          `/messages/${encodeURIComponent(id)}`,
          "GET",
          undefined,
          opts,
        ),
      update: (
        id: string,
        patch: WindChimeMessagePatch,
        opts?: WindChimeRequestOptions,
      ) =>
        mutate<{ ok: true }>(
          messageChanges,
          `/messages/${encodeURIComponent(id)}`,
          "PATCH",
          patch,
          opts,
        ),
      delete: (id: string, opts?: WindChimeRequestOptions) =>
        mutate<{ ok: true }>(
          messageChanges,
          `/messages/${encodeURIComponent(id)}`,
          "DELETE",
          undefined,
          opts,
        ),
      block: (id: string, opts?: WindChimeRequestOptions) =>
        mutate<{ ok: true }>(
          [...messageChanges, "blocklist"],
          `/messages/${encodeURIComponent(id)}/block`,
          "POST",
          undefined,
          opts,
        ),
      batch: (
        action: "delete" | "markRead",
        ids: string[],
        opts?: WindChimeRequestOptions,
      ) =>
        mutate<{ ok: true }>(
          messageChanges,
          "/messages/batch",
          "POST",
          { action, ids },
          opts,
        ),
    },
    topics: {
      list: (opts: { includeArchived?: boolean; signal?: AbortSignal } = {}) =>
        request<{ items: WindChimeTopic[] }>(
          `/topics${opts.includeArchived ? "?include=archived" : ""}`,
          "GET",
          undefined,
          opts,
        ),
      get: (id: string, opts?: Pick<WindChimeRequestOptions, "signal">) =>
        request<WindChimeTopic>(
          `/topics/${encodeURIComponent(id)}`,
          "GET",
          undefined,
          opts,
        ),
      listPublic: async (
        opts: { signal?: AbortSignal } = {},
      ): Promise<{ items: WindChimePublicTopic[] }> => {
        const result = await request<{ items: WindChimeTopic[] }>(
          "/topics?view=public",
          "GET",
          undefined,
          opts,
        );
        return { items: result.items.map(toWindChimePublicTopic) };
      },
      listAdmin: (
        opts: { includeArchived?: boolean; signal?: AbortSignal } = {},
      ) =>
        request<{ items: WindChimeAdminTopic[] }>(
          `/topics?view=admin${opts.includeArchived ? "&include=archived" : ""}`,
          "GET",
          undefined,
          opts,
        ),
      getPublic: async (
        id: string,
        opts?: Pick<WindChimeRequestOptions, "signal">,
      ): Promise<WindChimePublicTopic> =>
        toWindChimePublicTopic(
          await request<WindChimeTopic>(
            `/topics/${encodeURIComponent(id)}?view=public`,
            "GET",
            undefined,
            opts,
          ),
        ),
      getAdmin: (id: string, opts?: Pick<WindChimeRequestOptions, "signal">) =>
        request<WindChimeAdminTopic>(
          `/topics/${encodeURIComponent(id)}?view=admin`,
          "GET",
          undefined,
          opts,
        ),
      create: (input: WindChimeTopicCreateInput) =>
        mutate<WindChimeAdminTopic>(["topics"], "/topics", "POST", input),
      update: (id: string, patch: WindChimeTopicPatchInput) =>
        mutate<WindChimeAdminTopic>(
          ["topics", "settings"],
          `/topics/${encodeURIComponent(id)}`,
          "PATCH",
          patch,
        ),
      archive: (id: string, opts: { markReadFirst?: boolean } = {}) =>
        mutate<
          Omit<WindChimeTopicArchiveResponse, "topic"> & {
            topic: WindChimeAdminTopic;
          }
        >(messageChanges, `/topics/${encodeURIComponent(id)}`, "DELETE", opts),
      restore: (id: string) =>
        mutate<WindChimeAdminTopic>(
          ["topics"],
          `/topics/${encodeURIComponent(id)}`,
          "PATCH",
          { archivedAt: null },
        ),
      purge: (id: string) =>
        mutate<{ ok: true; topic: WindChimeAdminTopic }>(
          messageChanges,
          `/topics/${encodeURIComponent(id)}/purge`,
          "DELETE",
        ),
    },
    settings: {
      get: (opts?: Pick<WindChimeRequestOptions, "signal">) =>
        request<{ enabled: boolean }>("/settings", "GET", undefined, opts),
      set: (enabled: boolean) =>
        mutate<{ enabled: boolean }>(
          ["settings", "topics"],
          "/settings",
          "PUT",
          { enabled },
        ),
    },
    blockedTerms: {
      get: (opts?: Pick<WindChimeRequestOptions, "signal">) =>
        request<{ terms: string[] }>("/blocked-terms", "GET", undefined, opts),
      set: (terms: string[]) =>
        mutate<{ terms: string[] }>(["blockedTerms"], "/blocked-terms", "PUT", {
          terms,
        }),
    },
    blocklist: {
      list: (opts?: Pick<WindChimeRequestOptions, "signal">) =>
        request<WindChimeBlockedSender[]>("/blocklist", "GET", undefined, opts),
      unblock: (hash: string) =>
        mutate<{ ok: true }>(
          ["blocklist"],
          `/blocklist/${encodeURIComponent(hash)}`,
          "DELETE",
        ),
    },
    exportCsv: windChimeMessagesToCsv,
  };
}
export type WindChimeClient = ReturnType<typeof createWindChimeClient>;
