// Example-owned login. Replace these callbacks with your site's session check.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const cookieName = "windchime_example_session";
const ttl = 12 * 60 * 60;
function secret() {
  return process.env.EXAMPLE_SESSION_SECRET || "";
}
function signature(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}
function equal(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function hasAdminAccess(req: Request): boolean {
  if (!secret()) return false;
  const token = (req.headers.get("cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!token) return false;
  const [expires, nonce, digest] = token.split(".");
  return (
    !!nonce &&
    !!digest &&
    Number(expires) > Date.now() &&
    equal(signature(`${expires}.${nonce}`), digest)
  );
}
function isSameOrigin(req: Request): boolean {
  try {
    const url = new URL(req.url);
    // Next's Request URL may contain the internal listen address (for example,
    // 0.0.0.0:3000). Host preserves the browser-facing authority through port
    // mappings and a reverse proxy that forwards the original Host header.
    const authority = req.headers.get("host") || url.host;
    return (
      req.headers.get("origin") ===
      new URL(`${url.protocol}//${authority}`).origin
    );
  } catch {
    return false;
  }
}
export function authorizeAdmin(req: Request) {
  if (!hasAdminAccess(req))
    return Response.json(
      { code: "UNAUTHORIZED", error: "请先登录" },
      { status: 401 },
    );
  if (!["GET", "HEAD"].includes(req.method) && !isSameOrigin(req))
    return Response.json({ error: "请求来源不正确" }, { status: 403 });
  return null;
}
const attempts = new Map<string, number[]>();
export async function login(req: Request) {
  if (!isSameOrigin(req))
    return Response.json({ error: "请求来源不正确" }, { status: 403 });
  if (!secret() || !process.env.EXAMPLE_ADMIN_PASSWORD)
    return Response.json({ error: "请先运行 npm run setup" }, { status: 503 });
  const key = req.headers.get("x-forwarded-for") || "local";
  const now = Date.now(),
    recent = (attempts.get(key) || []).filter((t) => t > now - 60_000);
  if (recent.length >= 5)
    return Response.json(
      { error: "请稍后再试" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  attempts.set(key, [...recent, now]);
  const body = await req.json().catch(() => null);
  if (
    typeof body?.password !== "string" ||
    !equal(body.password, process.env.EXAMPLE_ADMIN_PASSWORD)
  )
    return Response.json({ error: "密码错误" }, { status: 401 });
  attempts.delete(key);
  const value = `${now + ttl * 1000}.${randomBytes(16).toString("hex")}`;
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": cookie(`${value}.${signature(value)}`, ttl) } },
  );
}
function cookie(value: string, maxAge: number) {
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export function logout(req: Request) {
  if (!isSameOrigin(req))
    return Response.json({ error: "请求来源不正确" }, { status: 403 });
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": cookie("", 0) } },
  );
}
