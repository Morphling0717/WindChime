import { createHash } from "node:crypto";
/** Preserves the two existing hosts' proxy precedence. Configure proxies to overwrite trusted headers. */
export function getWindChimeClientIp(req: Request): string {
  for (const header of ["cf-connecting-ip", "x-real-ip"]) {
    const value = req.headers.get(header)?.trim();
    if (value) return value;
  }
  const forwarded = req.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded?.[forwarded.length - 1] ?? "0.0.0.0";
}
export function computeWindChimeSenderIdentity(
  req: Request,
  fingerprint: string | null | undefined,
  hashSalt: string,
  getClientIp = getWindChimeClientIp,
): { hash: string; label: string } {
  const raw = `${getClientIp(req)}\n${req.headers.get("user-agent") ?? ""}\n${(fingerprint ?? "").trim()}\n${hashSalt}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  return { hash, label: `User-${hash.slice(0, 4).toUpperCase()}` };
}
