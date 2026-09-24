import {
  normalizeWindChimeTerms,
  WindChimeError,
  type WindChimeBlockedSender,
} from "../core/index.js";
import type {
  WindChimeSqlExecutor,
  WindChimeStorage,
} from "../sqlite/index.js";
import { createTopicOperations } from "./topics.js";
import { createMessageOperations } from "./messages.js";
import { readBlockedTermsEnabled } from "./keyword-settings.js";
import { getWindChimeClientIp } from "./identity.js";
import { boolInput, fail } from "./validation.js";
import { createWindChimeBroadcast } from "./live.js";
import { cleanupLiveMedia, saveLiveUpload } from "./live-media.js";
export { readLiveAsset } from "./live-media.js";
export type { LiveGrantRow, LiveProof } from "./live.js";
export {
  getWindChimeClientIp,
  computeWindChimeSenderIdentity,
} from "./identity.js";
export { toWindChimePublicTopic } from "../core/index.js";
export type { ListTopicsOptions } from "./topics.js";
export type WindChimeServiceOptions = {
  storage: WindChimeStorage;
  /** Keep this stable across upgrades, including explicitly empty legacy salts. New sites should generate a random salt. */
  hashSalt: string;
  blockedTerms?: string[] | string;
  turnstileSecret?: string;
  getClientIp?: (req: Request) => string;
  /** Host migrations after storage.ready. Pass a function to avoid module initialization cycles. */
  ready?: () => Promise<unknown>;
  fetch?: typeof fetch;
  now?: () => number;
  /** Test/embedded runtime override. Defaults to a fresh identity per Node process. */
  runtimeEpoch?: string;
};
/** Server-only service. Authorization belongs to the host/route adapter; do not expose methods directly to public server actions. */
export function createWindChimeService(options: WindChimeServiceOptions) {
  if (typeof options.hashSalt !== "string")
    throw new Error("WindChime requires an explicit stable hashSalt");
  const storage = options.storage,
    now = options.now ?? Date.now,
    getClientIp = options.getClientIp ?? getWindChimeClientIp;
  async function ready(): Promise<void> {
    await storage.ready;
    await options.ready?.();
  }
  async function readTerms(db: WindChimeSqlExecutor): Promise<string[]> {
    const row = await db.get<{ value: string }>(
      "SELECT value FROM mail_settings WHERE key='mail.blocked_terms'",
    );
    let values: string[];
    if (row) {
      try {
        const parsed = JSON.parse(row.value);
        values = Array.isArray(parsed)
          ? parsed.filter((value): value is string => typeof value === "string")
          : row.value.split(",");
      } catch {
        values = row.value.split(",");
      }
    } else
      values =
        typeof options.blockedTerms === "string"
          ? options.blockedTerms.split(",")
          : (options.blockedTerms ?? []);
    return normalizeWindChimeTerms(values);
  }
  async function getBlockedTerms() {
    await ready();
    return readTerms(storage);
  }
  async function getBlockedTermsEnabled() {
    await ready();
    return readBlockedTermsEnabled(storage);
  }
  async function setBlockedTermsEnabled(value: boolean) {
    boolInput(value, "blockedTermsEnabled");
    await ready();
    await storage.run(
      "INSERT INTO mail_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      ["mail.blocked_terms_enabled", JSON.stringify(value), new Date(now()).toISOString()],
    );
    return getSettings();
  }
  async function setBlockedTerms(terms: string[]): Promise<string[]> {
    if (!Array.isArray(terms) || terms.some((term) => typeof term !== "string"))
      fail("INVALID_TERMS", "terms 必须是字符串数组");
    const normalized = normalizeWindChimeTerms(terms);
    await ready();
    await storage.run(
      "INSERT INTO mail_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      [
        "mail.blocked_terms",
        JSON.stringify(normalized),
        new Date(now()).toISOString(),
      ],
    );
    return normalized;
  }
  async function verifyTurnstile(req: Request, token: string | null) {
    const secret = options.turnstileSecret?.trim();
    if (!secret) return;
    if (!token) fail("TURNSTILE_REQUIRED", "人机校验未完成", 403);
    const form = new URLSearchParams({ secret, response: token });
    const ip = getClientIp(req);
    if (ip !== "0.0.0.0") form.set("remoteip", ip);
    try {
      const response = await (options.fetch ?? fetch)(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form.toString(),
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok)
        fail("TURNSTILE_UNAVAILABLE", "人机校验服务暂不可用", 502);
      const result = (await response.json()) as { success?: boolean };
      if (result.success !== true)
        fail("TURNSTILE_FAILED", "人机校验未通过", 403);
    } catch (error) {
      if (error instanceof WindChimeError) throw error;
      fail("TURNSTILE_UNAVAILABLE", "人机校验请求失败", 502);
    }
  }
  const topics = createTopicOperations(storage, ready, now);
  const messages = createMessageOperations({
    storage,
    ready,
    now,
    hashSalt: options.hashSalt,
    getClientIp,
    getBlockedTerms: readTerms,
    verifyTurnstile,
  });
  const live = createWindChimeBroadcast({ storage, ready, now, runtimeEpoch: options.runtimeEpoch });
  const broadcast = {
    ...live,
    upload: async (req: Request, topicId: string, files: Uint8Array[], directory: string, token: string | null) => {
      if (!files.length || files.length > 3) fail("INVALID_ATTACHMENTS", "每次上传 1 至 3 张图片");
      await ready();
      await live.rateLimit("upload:" + getClientIp(req), 10, 60000);
      await verifyTurnstile(req, token);
      const topic = (await topics.getTopicById(topicId)) ?? (await topics.getTopicBySlug(topicId));
      if (!topic || !topic.isEnabledNow) fail("TOPIC_UNAVAILABLE", "当前信箱不接受投稿", 423);
      await cleanupLiveMedia(storage, directory, now());
      const attachments = [];
      for (const bytes of files) attachments.push(await saveLiveUpload(storage, topic.id, bytes, directory, now()));
      return { ...(attachments.length === 1 ? attachments[0] : {}), attachments };
    },
    cleanupMedia: (directory: string) => cleanupLiveMedia(storage, directory, now()),
    uploadReview: async (req: Request, topicId: string, messageId: string, files: Uint8Array[], directory: string) => {
      if (!files.length || files.length > 3) fail("INVALID_ATTACHMENTS", "每次上传 1 至 3 张图片");
      await ready(); await live.rateLimit("review-upload:" + getClientIp(req), 20, 60000);
      const topic = (await topics.getTopicById(topicId)) ?? (await topics.getTopicBySlug(topicId));
      if (!topic || topic.archivedAt) fail("TOPIC_UNAVAILABLE", "当前信箱不可编辑", 423);
      await messages.getMessage(messageId, topic.id);
      await cleanupLiveMedia(storage, directory, now());
      const attachments = [];
      for (const bytes of files) {
        const { receipt: _receipt, ...asset } = await saveLiveUpload(storage, topic.id, bytes, directory, now(), messageId);
        attachments.push({ ...asset, caption: "" });
      }
      return { ...(attachments.length === 1 ? attachments[0] : {}), attachments };
    },
    clientIp: getClientIp,
  };
  async function getSettings() {
    const topic = await topics.getDefaultTopic();
    if (!topic) fail("NOT_INITIALIZED", "默认主题未初始化", 503);
    return { enabled: topic.isEnabled, blockedTermsEnabled: await getBlockedTermsEnabled() };
  }
  async function updateSettings(input: { enabled: boolean }) {
    boolInput(input.enabled, "enabled");
    const topic = await topics.updateTopic("default", {
      isEnabled: input.enabled,
    });
    return { enabled: topic.isEnabled, blockedTermsEnabled: await getBlockedTermsEnabled() };
  }
  // Legacy blocklist previews have no source message ID. Only expose a preview
  // when its sender and text prefix still match an unflagged original, and no
  // flagged original. Purged/untraceable previews remain stored but hidden.
  async function listBlockedSenders(): Promise<WindChimeBlockedSender[]> {
    await ready();
    const rows = await storage.all<{
      hash: string;
      label: string | null;
      blocked_at: string;
      sample_text: string | null;
    }>(`SELECT blocked.hash, blocked.label, blocked.blocked_at,
      CASE WHEN blocked.sample_text IS NOT NULL
        AND EXISTS (SELECT 1 FROM mail_messages message
          WHERE message.sender_hash = blocked.hash AND message.is_flagged = 0
          AND substr(message.text, 1, length(blocked.sample_text)) = blocked.sample_text)
        AND NOT EXISTS (SELECT 1 FROM mail_messages message
          WHERE message.sender_hash = blocked.hash AND message.is_flagged = 1
          AND substr(message.text, 1, length(blocked.sample_text)) = blocked.sample_text)
        THEN blocked.sample_text ELSE NULL END AS sample_text
      FROM mail_blocklist blocked ORDER BY blocked.blocked_at DESC`);
    return rows.map((row) => ({
      hash: row.hash,
      label: row.label,
      blockedAt: row.blocked_at,
      sampleText: row.sample_text,
    }));
  }
  async function unblockSender(hash: string) {
    await ready();
    const result = await storage.run(
      "DELETE FROM mail_blocklist WHERE hash=?",
      [hash],
    );
    if (!result.changes) fail("SENDER_NOT_FOUND", "未找到屏蔽记录", 404);
    return { ok: true as const };
  }
  return {
    ready,
    broadcast,
    ...topics,
    ...messages,
    getBlockedTerms,
    setBlockedTerms,
    getBlockedTermsEnabled,
    setBlockedTermsEnabled,
    getSettings,
    updateSettings,
    listBlockedSenders,
    unblockSender,
  };
}
export type WindChimeService = ReturnType<typeof createWindChimeService>;
