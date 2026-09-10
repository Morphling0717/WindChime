import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, unlink, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { WindChimeSqlExecutor, WindChimeStorage } from "../sqlite/index.js";
import { fail, objectInput, onlyFields, textInput } from "./validation.js";

export const liveHash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const liveSecret = () => randomBytes(32).toString("base64url");
export type LiveAssetRow = {
  id: string; topic_id: string; message_id: string | null; ordinal: number;
  sha256: string; mime_type: string; width: number; height: number; size: number;
  receipt_hash: string | null; created_at: number; expires_at: number;
};
export function liveAssetDto(row: LiveAssetRow, caption = "") {
  return { id: row.id, caption, mimeType: row.mime_type, width: row.width, height: row.height, sha256: row.sha256 };
}
export function validateLiveAttachments(value: unknown): Array<{ id: string; receipt: string }> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) fail("INVALID_ATTACHMENTS", "每封信最多 3 张图片");
  const rows = value.map((item) => {
    const raw = objectInput(item); onlyFields(raw, ["id", "receipt"]);
    return { id: textInput(raw.id, 100, "图片 ID", true)!, receipt: textInput(raw.receipt, 100, "上传收据", true)! };
  });
  if (new Set(rows.map((r) => r.id)).size !== rows.length) fail("INVALID_ATTACHMENTS", "图片不能重复");
  return rows;
}
export async function claimLiveAttachments(db: WindChimeSqlExecutor, attachments: Array<{ id: string; receipt: string }>, topicId: string, messageId: string, now: number) {
  for (const [ordinal, item] of attachments.entries()) {
    const result = await db.run(`UPDATE mail_live_assets SET message_id=?,ordinal=?,receipt_hash=NULL
      WHERE id=? AND topic_id=? AND message_id IS NULL AND receipt_hash=? AND expires_at>?`,
      [messageId, ordinal, item.id, topicId, liveHash(item.receipt), now]);
    if (result.changes !== 1) fail("INVALID_RECEIPT", "图片收据已使用、已过期或不属于当前信箱", 409);
  }
}
const MAX_INPUT = 5 * 1024 * 1024;
let activeDecodes = 0;
export async function saveLiveUpload(storage: WindChimeStorage, topicId: string, bytes: Uint8Array, directory: string, now: number, reviewMessageId?: string) {
  if (!bytes.length || bytes.length > MAX_INPUT) fail("IMAGE_TOO_LARGE", "图片最大 5 MiB", 413);
  if (activeDecodes >= 2) fail("UPLOAD_BUSY", "图片处理繁忙，请稍后再试", 429);
  activeDecodes++;
  let output: Buffer; let width: number; let height: number;
  try {
    // Lazy optional dependency: ordinary headless/server consumers do not load sharp.
    const sharp = (await import("sharp")).default;
    const decoder = sharp(bytes, { limitInputPixels: 16_000_000, failOn: "warning", animated: true }).timeout({ seconds: 10 });
    const meta = await decoder.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height)
      fail("INVALID_IMAGE", "仅支持静态 JPEG、PNG、WebP 图片");
    if (meta.width * meta.height > 16_000_000) fail("IMAGE_TOO_LARGE", "图片最多 1600 万像素", 413);
    const result = await decoder.rotate().webp({ quality: 90, effort: 3 }).toBuffer({ resolveWithObject: true });
    output = result.data; width = result.info.width; height = result.info.height;
  } catch (error) {
    if (error instanceof Error && error.name === "WindChimeError") throw error;
    fail("INVALID_IMAGE", "图片无法安全解码，请使用静态 JPEG、PNG、WebP 图片");
  } finally { activeDecodes--; }
  if (output!.length > MAX_INPUT) fail("IMAGE_TOO_LARGE", "规范化图片超过 5 MiB", 413);
  const id = randomUUID(), receipt = liveSecret(), hash = liveHash(output!);
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  // One immutable object per unique ID, never a caller-provided filename or remote URL.
  const file = join(root, id + ".webp");
  await writeFile(file, output!, { flag: "wx", mode: 0o600 });
  try {
    await storage.transaction(async (db) => {
      if (reviewMessageId && !(await db.get("SELECT id FROM mail_messages WHERE id=? AND topic_id=? AND deleted_at IS NULL", [reviewMessageId,topicId]))) fail("MESSAGE_NOT_FOUND", "信件不存在或已删除", 404);
      const quota = await db.get<{ daily: number; total: number }>(`SELECT
        COALESCE(SUM(CASE WHEN created_at>? THEN size ELSE 0 END),0) daily,
        COALESCE(SUM(size),0) total FROM mail_live_assets WHERE topic_id=?`, [now - 86400000, topicId]);
      if ((quota?.daily ?? 0) + output!.length > 200 * 1024 * 1024 || (quota?.total ?? 0) + output!.length > 2 * 1024 * 1024 * 1024)
        fail("UPLOAD_QUOTA", "当前信箱图片存储额度已满", 429);
      await db.run(`INSERT INTO mail_live_assets(id,topic_id,message_id,purpose,sha256,mime_type,width,height,size,receipt_hash,created_at,expires_at)
        VALUES(?,?,?,?,?,'image/webp',?,?,?,?,?,?)`, [id, topicId, reviewMessageId ?? null, reviewMessageId ? "review" : "source", hash, width!, height!, output!.length, reviewMessageId ? null : liveHash(receipt), now, now + 86400000]);
    });
  } catch (error) { await unlink(file).catch(() => undefined); throw error; }
  return { id, receipt, mimeType: "image/webp", width: width!, height: height!, size: output!.length, sha256: hash };
}
export async function readLiveAsset(row: LiveAssetRow, directory: string) {
  if (!/^[a-f0-9-]{36}$/.test(row.id)) fail("ASSET_NOT_FOUND", "图片不存在", 404);
  const bytes = await readFile(join(resolve(directory), row.id + ".webp")).catch(() => null);
  if (!bytes || bytes.length !== row.size || liveHash(bytes) !== row.sha256) fail("ASSET_UNAVAILABLE", "图片内容不可确认", 409);
  return bytes;
}
/** Call periodically or before uploads; only private generated orphan objects older than 24 hours are removed. */
export async function cleanupLiveMedia(storage: WindChimeStorage, directory: string, now: number) {
  await storage.run("DELETE FROM mail_live_assets WHERE message_id IS NULL AND expires_at<=?", [now]);
  const root = resolve(directory);
  for (const name of await readdir(root).catch(() => [] as string[])) {
    if (!/^[a-f0-9-]{36}\.webp$/.test(name)) continue;
    const id = name.slice(0, -5);
    if (await storage.get("SELECT id FROM mail_live_assets WHERE id=?", [id])) continue;
    const path = join(root, name), info = await stat(path).catch(() => null);
    if (info && info.mtimeMs < now - 86400000) await unlink(path);
  }
}
