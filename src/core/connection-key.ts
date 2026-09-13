import { WindChimeError } from "./errors.js";

export type WindChimeConnectionKey = {
  v: 1; origin: string; siteId: string; token: string;
};
export type WindChimeConnectionIdentity = {
  scope: "site" | "topic"; siteId: string; topicId: string | null; topicTitle: string | null;
  label: string; expiresAt: string; grantId: string;
};

const prefix = "wc_conn_v1.";
const maxLength = 4096;
function invalid(): never {
  throw new WindChimeError("CONNECTION_KEY_INVALID", 400, "连接密钥格式无效，请在网站后台重新生成");
}
function origin(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || /[\\\s\u0000-\u001f\u007f]/.test(value)) return invalid();
  const match = /^(https?):\/\/(\[[^\]]+\]|[^:/?#@]+)(?::\d+)?\/?$/i.exec(value);
  if (!match) return invalid();
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return invalid();
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(match[2].toLowerCase()))) return invalid();
  return url.origin;
}
function payload(value: unknown): WindChimeConnectionKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 4 || Object.keys(data).some(key => !["v", "origin", "siteId", "token"].includes(key))) return invalid();
  if (data.v !== 1 || typeof data.siteId !== "string" || !data.siteId.trim() || data.siteId.length > 200 || /[\u0000-\u001f\u007f]/.test(data.siteId)) return invalid();
  if (typeof data.token !== "string" || !/^wc_ctl_[A-Za-z0-9_-]{43}$/.test(data.token)) return invalid();
  return { v: 1, origin: origin(data.origin), siteId: data.siteId, token: data.token };
}
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** A reusable control credential, not encryption or a one-time pairing ticket. */
export function encodeWindChimeConnectionKey(value: Omit<WindChimeConnectionKey, "v"> & { v?: 1 }): string {
  try {
    const data = payload({ v: 1, ...value });
    const key = prefix + base64url(new TextEncoder().encode(JSON.stringify(data)));
    if (key.length > maxLength) return invalid();
    return key;
  } catch { return invalid(); }
}
/** Uses browser-standard APIs, so the same validation runs in web and desktop code. */
export function parseWindChimeConnectionKey(value: unknown): WindChimeConnectionKey {
  try {
    if (typeof value !== "string" || value.length > maxLength) return invalid();
    const key = value.trim();
    if (!key.startsWith(prefix)) return invalid();
    const encoded = key.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return invalid();
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    if (base64url(bytes) !== encoded) return invalid();
    return payload(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { return invalid(); }
}
