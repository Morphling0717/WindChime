import { createPublicKey, verify } from "node:crypto";
import { WindChimeError } from "../core/errors.js";
import type { WindChimeLiveAction } from "../core/live.js";
import type { WindChimeService } from "../server/index.js";
import type { LiveGrantRow, LiveProof } from "../server/live.js";
import { readLiveAsset } from "../server/live-media.js";
import { fail, objectInput, onlyFields, textInput, boolInput } from "../server/validation.js";
import type { WindChimeRouteOptions } from "./index.js";

export type WindChimeLiveRouteOptions = Pick<WindChimeRouteOptions, "service" | "authorizeAdmin" | "hasAdminAccess" | "onError"> & {
  basePath?: string; mediaDirectory?: string; allowedOrigins?: string[];
  gatewayPublicKeys?: Record<string, string>; gatewayIssuer?: string;
  /** Public origin behind a trusted proxy; never derived from caller-supplied forwarded headers. */
  publicOrigin?: string;
  now?: () => number;
};
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } }); }
async function limitedBody(req: Request, max: number) {
  if (Number(req.headers.get("content-length")) > max) fail("BODY_TOO_LARGE", "请求内容过大", 413);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const deadline = performance.now() + 30000;
  try {
    for (;;) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) fail("REQUEST_TIMEOUT", "上传请求超时", 408);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const item = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new WindChimeError("REQUEST_TIMEOUT",408,"上传请求超时")), remaining); }),
      ]).finally(() => clearTimeout(timer));
      if (item.done) break;
      size += item.value.length; if (size > max) { await reader.cancel(); fail("BODY_TOO_LARGE", "请求内容过大", 413); }
      chunks.push(item.value);
    }
  } catch(error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0; for (const c of chunks) { bytes.set(c, at); at += c.length; } return bytes;
}
async function body(req: Request) {
  const bytes = await limitedBody(req, 128 * 1024);
  try { return objectInput(bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : {}); }
  catch (error) { if (error instanceof WindChimeError) throw error; return fail("INVALID_JSON", "请求体必须是 JSON 对象"); }
}
async function uploadBody(req: Request, review = false) {
  const bytes = await limitedBody(req, 16 * 1024 * 1024);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData(); }
  catch { return fail("INVALID_UPLOAD", "请使用 multipart/form-data 上传图片"); }
  const allowed = review ? ["topicId","messageId","file"] : ["topicId","turnstileToken","file"];
  for (const key of form!.keys()) if (!allowed.includes(key)) fail("INVALID_FIELD", "上传字段无效");
  const topicId = textInput(form!.get("topicId"), 100, "信箱") ?? "default";
  const messageId = review ? textInput(form!.get("messageId"),100,"信件",true)! : null;
  const token = review ? null : textInput(form!.get("turnstileToken"),4096,"验证令牌");
  const entries = form!.getAll("file");
  if (!entries.length || entries.length > 3 || entries.some((v) => typeof v === "string" || v.size > 5*1024*1024)) fail("INVALID_UPLOAD", "每次最多 3 张、每张最大 5 MiB", 413);
  const files: Uint8Array[] = []; for (const item of entries) files.push(new Uint8Array(await (item as File).arrayBuffer()));
  return { topicId, messageId, token, files };
}
function bearer(req: Request) {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{40,150})$/.exec(header);
  if (!match) fail("UNAUTHORIZED", "授权格式无效", 401); return match![1];
}
export function verifyWindChimeGatewayProof(token: string, options: { publicKeys: Record<string,string>; issuer: string; audience: string; kind: LiveProof["kind"]; now: number }): LiveProof {
  try {
    if (typeof token !== "string" || token.length > 12000) throw new Error();
    const parts = token.split("."); if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString()), proof = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (header.alg !== "EdDSA" || typeof header.kid !== "string" || !Object.prototype.hasOwnProperty.call(options.publicKeys, header.kid)) throw new Error();
    const key = createPublicKey(options.publicKeys[header.kid]); if (key.asymmetricKeyType !== "ed25519") throw new Error();
    if (!verify(null, Buffer.from(parts[0]+"."+parts[1]), key, Buffer.from(parts[2], "base64url"))) throw new Error();
    if (proof.kind !== options.kind || proof.iss !== options.issuer || proof.aud !== options.audience) throw new Error();
    for (const name of ["siteId", "topicId", "bindingId", "biliSubject", "sessionId", "jti"]) if (typeof proof[name] !== "string" || !proof[name] || proof[name].length > 200) throw new Error();
    const stamp = options.now / 1000, maxAge = options.kind === "lease" ? 3 : options.kind === "display" ? 60 : 300;
    if (!Number.isSafeInteger(proof.iat) || !Number.isSafeInteger(proof.exp) || proof.iat > stamp+1 || proof.exp <= stamp || proof.exp <= proof.iat || proof.exp-proof.iat > maxAge || proof.exp-stamp > maxAge) throw new Error();
    if (options.kind === "binding" && (typeof proof.nonce !== "string" || proof.nonce.length > 100)) throw new Error();
    return proof as LiveProof;
  } catch { return fail("INVALID_PROOF", "平台授权证明无效或已过期", 401); }
}
/** A separate authority boundary. Display credentials never reach the legacy/admin handler. */
export function createWindChimeLiveRouteHandlers(options: WindChimeLiveRouteOptions) {
  const service: WindChimeService = options.service, live = service.broadcast;
  const base = (options.basePath ?? "/api/mail/live").replace(/\/$/, ""), now = options.now ?? Date.now;
  const origin = (req: Request) => options.publicOrigin ? new URL(options.publicOrigin).origin : new URL(req.url).origin;
  function checkOrigin(req: Request) {
    const supplied = req.headers.get("origin");
    if (supplied && supplied !== origin(req) && !options.allowedOrigins?.includes(supplied)) fail("ORIGIN_FORBIDDEN", "请求来源未获允许", 403);
    if (req.headers.get("sec-fetch-site") === "cross-site" && !supplied) fail("ORIGIN_FORBIDDEN", "请求来源未获允许", 403);
  }
  async function admin(req: Request) {
    const supplied = req.headers.get("origin"), site = req.headers.get("sec-fetch-site");
    if ((supplied && supplied !== origin(req)) || (site && !["same-origin", "none"].includes(site)))
      fail("ORIGIN_FORBIDDEN", "请在本站后台使用管理员会话", 403);
    const result = await options.authorizeAdmin(req);
    if (result instanceof Response) return result;
    if (result === false) return json({ code: "UNAUTHORIZED", error: "需要管理员登录" }, 401);
    return null;
  }
  async function control(req: Request, scope: string): Promise<LiveGrantRow | Response | null> {
    const token = bearer(req); if (token) return live.authenticate(token, "control", scope);
    return admin(req);
  }
  function proof(req: Request, value: unknown, kind: LiveProof["kind"]) {
    if (!options.gatewayIssuer || !options.gatewayPublicKeys || typeof value !== "string") fail("GATEWAY_NOT_CONFIGURED", "尚未配置平台网关公钥", 503);
    return verifyWindChimeGatewayProof(value as string, { publicKeys: options.gatewayPublicKeys!, issuer: options.gatewayIssuer!, audience: origin(req), kind, now: now() });
  }
  async function display(req: Request, leaseRequired = true) {
    const token = bearer(req); if (!token) fail("UNAUTHORIZED", "需要展示授权", 401);
    const grant = await live.authenticate(token!, "display");
    if (grant.binding_id && leaseRequired) await live.validateLease(grant, proof(req, req.headers.get("x-windchime-platform-lease"), "lease"));
    return grant;
  }
  async function handle(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      if (url.pathname !== base && !url.pathname.startsWith(base+"/")) return json({code:"NOT_FOUND",error:"接口不存在"},404);
      const path = url.pathname.slice(base.length).replace(/^\/+|\/+$/g, "");
      if (req.method === "OPTIONS") { checkOrigin(req); return new Response(null, { status: 204 }); }
      if (req.method !== "GET") checkOrigin(req);
      if (path === "capabilities" && req.method === "GET") return json({ protocolVersion: 1, siteId: await live.siteId(), basePath: base, features: { images: !!options.mediaDirectory, pairing: true, broadcast: true }, pollIntervalMs: 1000, leaseMs: live.leaseMs });
      if (path === "upload" && req.method === "POST") {
        if (!options.mediaDirectory) fail("IMAGES_DISABLED", "此站点尚未配置图片存储", 503);
        const { topicId, token, files } = await uploadBody(req);
        return json(await live.upload(req,topicId,files,options.mediaDirectory!,token),201);
      }
      if (path === "control/upload" && req.method === "POST") {
        if (!options.mediaDirectory) fail("IMAGES_DISABLED", "此站点尚未配置图片存储", 503);
        const token = bearer(req);
        if (token) await live.authenticate(token,"control");
        else { const denied = await admin(req); if (denied) return denied; }
        const { topicId,messageId,files } = await uploadBody(req,true);
        if (token) await live.authenticate(token,"control",topicId);
        return json(await live.uploadReview(req,topicId,messageId!,files,options.mediaDirectory!),201);
      }
      if (path.startsWith("devices/")) {
        if (req.method !== "POST") return json({code:"NOT_FOUND",error:"接口不存在"},404);
        if (path === "devices/approve") { if (bearer(req)) fail("FORBIDDEN", "请在网站后台确认配对",403); const denied = await admin(req); if (denied) return denied; }
        await live.rateLimit("pair:"+path+":"+live.clientIp(req), path === "devices/poll" ? 90 : 10, 60000);
        const data = await body(req);
        if (path === "devices/request") { onlyFields(data,["deviceName","challenge"]); return json(await live.requestDevice(textInput(data.deviceName,100,"设备名称",true)!,textInput(data.challenge,100,"challenge",true)!),201); }
        if (path === "devices/approve") { onlyFields(data,["userCode","topicId"]); return json(await live.approveDevice(textInput(data.userCode,20,"配对码",true)!,textInput(data.topicId,100,"信箱",true)!)); }
        if (path === "devices/poll") { onlyFields(data,["deviceCode","verifier"]); return json(await live.pollDevice(textInput(data.deviceCode,100,"配对码",true)!,textInput(data.verifier,128,"verifier",true)!)); }
      }
      if (path.startsWith("control/")) {
        let data: Record<string,unknown> = {};
        // Authenticate cookies before reading the body (legacy callbacks use request.clone()).
        let initialAdmin: Response | null = null;
        if (!bearer(req)) { initialAdmin = await admin(req); if (initialAdmin) return initialAdmin; }
        if (["POST","PUT","PATCH"].includes(req.method)) data = await body(req);
        const scope = textInput(data.topicId ?? url.searchParams.get("topicId"),100,"信箱") ?? "default";
        const authority = bearer(req) ? await control(req,scope) : null; if (authority instanceof Response) return authority;
        const actor = authority ? "device:"+authority.id : "host-admin";
        if (path === "control/state" && req.method === "GET") return json(await live.state(scope));
        if (path === "control/action" && req.method === "POST") return json(await live.action(data as WindChimeLiveAction,actor));
        if (path === "control/message" && req.method === "POST") {
          onlyFields(data,["topicId","messageId","isRead","isFavorited"]);
          const patch: {isRead?:boolean;isFavorited?:boolean} = {};
          if (data.isRead !== undefined) patch.isRead=boolInput(data.isRead,"isRead");
          if (data.isFavorited !== undefined) patch.isFavorited=boolInput(data.isFavorited,"isFavorited");
          await service.updateMessage(textInput(data.messageId,100,"信件",true)!,patch,scope); return json(await live.state(scope));
        }
        if (path === "control/grants" && req.method === "GET") return json({items:await live.listGrants(scope)});
        if (path === "control/grants" && req.method === "POST") {
          onlyFields(data,["topicId","kind","label"]);
          if (data.kind !== "display" && data.kind !== "control") fail("INVALID_KIND","授权类型无效");
          if (authority && data.kind !== "display") fail("FORBIDDEN","设备不能签发管理授权",403);
          return json(await live.createGrant(scope,data.kind as "display"|"control",textInput(data.label,100,"名称")??"",undefined,null,null,authority?.id??null),201);
        }
        if (path.startsWith("control/grants/") && req.method === "DELETE") {
          const id=path.slice("control/grants/".length);
          if (authority) { const target=(await live.listGrants(scope)).find((g)=>g.id===id); if(target?.kind==="control") fail("FORBIDDEN","设备不能撤销其他管理授权",403); }
          return json(await live.revokeGrant(id,scope));
        }
        if (path.startsWith("control/assets/") && req.method === "GET") {
          if (!options.mediaDirectory) fail("IMAGES_DISABLED","未配置图片存储",503);
          const asset=await live.controlAsset(scope,path.slice("control/assets/".length));
          return new Response(new Uint8Array(await readLiveAsset(asset,options.mediaDirectory!)),{headers:{"content-type":asset.mime_type,"cache-control":"no-store","x-content-type-options":"nosniff"}});
        }
        if (path === "control/binding-challenge" && req.method === "POST") { onlyFields(data,["topicId"]); return json(await live.bindingChallenge(scope,origin(req))); }
        if (path === "control/bind" && req.method === "POST") { onlyFields(data,["topicId","proof"]); return json(await live.bind(scope,proof(req,data.proof,"binding"))); }
        if (path === "control/bind" && req.method === "DELETE") return json(await live.unbind(scope));
      }
      if (path === "gateway/exchange" && req.method === "POST") {
        await live.rateLimit("exchange:"+live.clientIp(req),30,60000);
        const data=await body(req);onlyFields(data,["proof"]);return json(await live.exchange(proof(req,data.proof,"display")));
      }
      if (path === "gateway/renew" && req.method === "POST") {
        const grant=await display(req,false),data=await body(req);onlyFields(data,["proof"]);
        return json(await live.exchange(proof(req,data.proof,"display"),grant));
      }
      if (path.startsWith("display/")) {
        const grant=await display(req);
        if (path === "display/open" && req.method === "POST") return json(await live.open(grant));
        const receiver=textInput(url.searchParams.get("receiverId"),100,"展示连接",true)!;
        if (path === "display/frame" && req.method === "GET") {
          const value = await live.frame(grant,receiver);
          await display(req); // Includes platform expiry after any database wait.
          if (grant.binding_id) {
            const lease = proof(req,req.headers.get("x-windchime-platform-lease"),"lease");
            value.leaseMs = Math.min(value.leaseMs,lease.exp*1000-now());
            if (value.leaseMs <= 0) fail("PLATFORM_UNCONFIRMED","平台连接不可确认",401);
          }
          return json(value);
        }
        if (path.startsWith("display/assets/") && req.method === "GET") {
          if (!options.mediaDirectory) fail("IMAGES_DISABLED","未配置图片存储",503);
          const activation=Number(url.searchParams.get("activation"));
          if (!Number.isSafeInteger(activation)) fail("INVALID_ACTIVATION","展示版本无效");
          const id=path.slice("display/assets/".length),asset=await live.displayAsset(grant,receiver,activation,id);
          const bytes=await readLiveAsset(asset,options.mediaDirectory!);
          // Disk I/O may race a hide/revoke: re-authorize immediately before returning bytes.
          const fresh=await display(req); await live.displayAsset(fresh,receiver,activation,id);
          return new Response(new Uint8Array(bytes),{headers:{"content-type":asset.mime_type,"cache-control":"no-store","x-content-type-options":"nosniff"}});
        }
      }
      return json({code:"NOT_FOUND",error:"接口不存在"},404);
    } catch(error) {
      if(error instanceof WindChimeError)return json({code:error.code,error:error.message},error.status);
      options.onError?.(error); return json({code:"INTERNAL_ERROR",error:"请求处理失败"},500);
    }
  }
  async function cors(req:Request) {
    const response=await handle(req),requestOrigin=req.headers.get("origin");
    if(requestOrigin && (requestOrigin===origin(req)||options.allowedOrigins?.includes(requestOrigin))) {
      response.headers.set("access-control-allow-origin",requestOrigin);response.headers.set("vary","Origin");
      if (requestOrigin===origin(req)) response.headers.set("access-control-allow-credentials","true");
      response.headers.set("access-control-allow-methods","GET,POST,DELETE,OPTIONS");
      response.headers.set("access-control-allow-headers","Authorization,Content-Type,X-WindChime-Platform-Lease");
    }
    return response;
  }
  return {GET:cors,POST:cors,DELETE:cors,PUT:cors,PATCH:cors,OPTIONS:cors};
}
