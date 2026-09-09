import { WindChimeError, isWindChimeInboxFilter } from "../core/index.js";
import type { WindChimeService } from "../server/index.js";
import {
  boolInput,
  fail,
  objectInput,
  onlyFields,
} from "../server/validation.js";
export type WindChimeRouteOptions = {
  service: WindChimeService;
  /** Return Response to deny, null/undefined/true to allow, false for a default 401. */
  authorizeAdmin: (
    request: Request,
  ) =>
    | Promise<Response | null | void | boolean>
    | Response
    | null
    | void
    | boolean;
  /** Non-mutating session check used only for dual public/admin reads. Defaults to public-only. */
  hasAdminAccess?: (request: Request) => Promise<boolean> | boolean;
  basePath?: string;
  onError?: (error: unknown) => void;
};
function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}
async function body(req: Request, stripLegacyPassword = false) {
  try {
    const parsed = objectInput(await req.json());
    // Host authorization reads the original request first. The old hosts also
    // accept JSON password credentials, which are not mailbox business fields.
    if (stripLegacyPassword) {
      const { password: _password, ...payload } = parsed;
      return payload;
    }
    return parsed;
  } catch (error) {
    if (error instanceof WindChimeError) throw error;
    return fail("INVALID_JSON", "请求体必须是有效 JSON 对象");
  }
}
/** Mount these standard Request/Response handlers in App Router routes, with `export const runtime = 'nodejs'`. */
export function createWindChimeRouteHandlers(options: WindChimeRouteOptions) {
  const base = (options.basePath ?? "/api/mail").replace(/\/$/, "");
  const service = options.service;
  async function handle(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      if (url.pathname !== base && !url.pathname.startsWith(base + "/"))
        return json({ error: "接口不存在", code: "NOT_FOUND" }, 404);
      let parts: string[];
      try {
        parts = url.pathname
          .slice(base.length)
          .split("/")
          .filter(Boolean)
          .map(decodeURIComponent);
      } catch {
        return json({ error: "路径编码无效", code: "INVALID_PATH" }, 400);
      }
      const [resource, id, action] = parts,
        method = req.method;
      const topicView =
        resource === "topics" && method === "GET"
          ? url.searchParams.get("view")
          : null;
      if (topicView !== null && !["public", "admin"].includes(topicView))
        fail("INVALID_VIEW", "view 必须是 public 或 admin");
      const publicRead =
        method === "GET" &&
        ((resource === "topics" && parts.length <= 2) ||
          (resource === "settings" && parts.length === 1));
      const publicSubmit =
        method === "POST" && resource === "messages" && parts.length === 1;
      if ((!publicRead && !publicSubmit) || topicView === "admin") {
        const auth = await options.authorizeAdmin(req);
        if (auth instanceof Response) return auth;
        if (auth === false)
          return json({ error: "需要管理员登录", code: "UNAUTHORIZED" }, 401);
      }
      const scope = url.searchParams.get("topicId") ?? "default";
      if (resource === "messages") {
        if (parts.length === 1 && method === "POST")
          return json(await service.submitMessage(await body(req), req), 201);
        if (parts.length === 1 && method === "GET") {
          const filter = url.searchParams.get("filter") ?? "all";
          if (!isWindChimeInboxFilter(filter))
            fail("INVALID_FILTER", "未知信件筛选");
          return json(await service.listMessages({ topicId: scope, filter }));
        }
        if (parts.length === 2 && id === "batch" && method === "POST")
          return json(
            await service.batchMessages(
              (await body(req, true)) as Parameters<
                typeof service.batchMessages
              >[0],
              scope,
            ),
          );
        if (parts.length === 3 && action === "block" && method === "POST")
          return json(await service.blockSender(id, scope));
        if (parts.length === 2 && method === "GET")
          return json(await service.getMessage(id, scope));
        if (parts.length === 2 && method === "PATCH")
          return json(
            await service.updateMessage(id, await body(req, true), scope),
          );
        if (parts.length === 2 && method === "DELETE")
          return json(await service.deleteMessage(id, scope));
      }
      if (resource === "topics") {
        if (parts.length === 1 && method === "GET") {
          if (
            topicView === "admin" ||
            (topicView !== "public" && (await options.hasAdminAccess?.(req)))
          )
            return json({
              items: await service.listTopics({
                includeArchived: url.searchParams.get("include") === "archived",
                withCounts: true,
              }),
            });
          return json({ items: await service.listPublicTopics() });
        }
        if (parts.length === 1 && method === "POST")
          return json(
            await service.createTopic(
              (await body(req, true)) as Parameters<
                typeof service.createTopic
              >[0],
            ),
            201,
          );
        if (parts.length === 2 && method === "GET") {
          const topic =
            topicView === "admin" ||
            (topicView !== "public" && (await options.hasAdminAccess?.(req)))
              ? ((await service.getTopicById(id)) ??
                (await service.getTopicBySlug(id)))
              : await service.getPublicTopic(id);
          if (!topic) fail("TOPIC_NOT_FOUND", "主题不存在", 404);
          return json(topic);
        }
        if (parts.length === 2 && method === "PATCH")
          return json(await service.updateTopic(id, await body(req, true)));
        if (parts.length === 2 && method === "DELETE") {
          let markReadFirst = false;
          const query = url.searchParams.get("markReadFirst");
          if (query !== null) {
            if (!["true", "false"].includes(query))
              fail("INVALID_INPUT", "markReadFirst 必须是 true 或 false");
            markReadFirst = query === "true";
          }
          const text = await req.text();
          if (text.trim()) {
            let raw: Record<string, unknown>;
            try {
              raw = objectInput(JSON.parse(text));
            } catch {
              fail("INVALID_JSON", "请求体必须是有效 JSON 对象");
            }
            delete raw!.password;
            onlyFields(raw!, ["markReadFirst"]);
            if ("markReadFirst" in raw!)
              markReadFirst = boolInput(raw!.markReadFirst, "markReadFirst");
          }
          return json(await service.archiveTopic(id, { markReadFirst }));
        }
        if (parts.length === 3 && action === "purge" && method === "DELETE")
          return json({
            ok: true,
            topic: await service.deleteArchivedTopic(id),
          });
      }
      if (resource === "settings" && parts.length === 1) {
        if (method === "GET") return json(await service.getSettings());
        if (method === "PUT") {
          const raw = await body(req, true);
          onlyFields(raw, ["enabled"]);
          return json(
            await service.updateSettings({
              enabled: boolInput(raw.enabled, "enabled"),
            }),
          );
        }
      }
      if (resource === "blocked-terms" && parts.length === 1) {
        if (method === "GET")
          return json({ terms: await service.getBlockedTerms() });
        if (method === "PUT") {
          const raw = await body(req, true);
          onlyFields(raw, ["terms"]);
          return json({
            terms: await service.setBlockedTerms(raw.terms as string[]),
          });
        }
      }
      if (resource === "blocklist") {
        if (parts.length === 1 && method === "GET")
          return json(await service.listBlockedSenders());
        if (parts.length === 2 && method === "DELETE")
          return json(await service.unblockSender(id));
      }
      return json({ error: "接口或方法不存在", code: "NOT_FOUND" }, 404);
    } catch (error) {
      if (error instanceof WindChimeError)
        return json(
          {
            error: error.message,
            code: error.code,
            ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}),
          },
          error.status,
          error.retryAfterMs
            ? {
                "retry-after": String(
                  Math.max(1, Math.ceil(error.retryAfterMs / 1000)),
                ),
              }
            : {},
        );
      options.onError?.(error);
      return json({ error: "服务器处理失败", code: "INTERNAL_ERROR" }, 500);
    }
  }
  return {
    GET: handle,
    POST: handle,
    PUT: handle,
    PATCH: handle,
    DELETE: handle,
  };
}
