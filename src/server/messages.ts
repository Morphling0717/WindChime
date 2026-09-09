import { randomUUID } from "node:crypto";
import {
  isWindChimeInboxFilter,
  validateWindChimeSubmission,
  matchWindChimeBlockedTerm,
  WindChimeError,
  type WindChimeMessageRecord,
  type WindChimeInboxFilter,
  type WindChimeMessageList,
  type WindChimeSubmitPayload,
} from "../core/index.js";
import type {
  WindChimeSqlExecutor,
  WindChimeStorage,
} from "../sqlite/index.js";
import { computeWindChimeSenderIdentity } from "./identity.js";
import { resolveTopic } from "./topics.js";
import {
  boolInput,
  fail,
  objectInput,
  onlyFields,
  textInput,
} from "./validation.js";
export type MessageRow = {
  id: string;
  topic_id: string;
  created_at: string;
  text: string;
  nickname: string | null;
  link_url: string | null;
  is_read: number;
  is_favorited: number;
  is_flagged: number;
  sender_hash: string | null;
  sender_label: string | null;
};
function messageDto(row: MessageRow, original = false): WindChimeMessageRecord {
  const redact = row.is_flagged && !original;
  return {
    id: row.id,
    topicId: row.topic_id,
    createdAt: row.created_at,
    text: redact ? "" : row.text,
    nickname: redact ? null : row.nickname,
    linkUrl: redact ? null : row.link_url,
    isRead: !!row.is_read,
    isFavorited: !!row.is_favorited,
    isFlagged: !!row.is_flagged,
    senderHash: row.sender_hash,
    senderLabel: row.sender_label,
  };
}
async function requireMessage(
  db: WindChimeSqlExecutor,
  id: string,
  scope: string,
  now: number,
) {
  const topic = await resolveTopic(db, scope, now);
  const row = await db.get<MessageRow>(
    "SELECT * FROM mail_messages WHERE id=? AND topic_id=? AND deleted_at IS NULL",
    [id, topic.id],
  );
  if (!row) fail("MESSAGE_NOT_FOUND", "未找到留言", 404);
  return row;
}
export type MessageOperationOptions = {
  storage: WindChimeStorage;
  ready: () => Promise<void>;
  now: () => number;
  hashSalt: string;
  getClientIp: (req: Request) => string;
  getBlockedTerms: (db: WindChimeSqlExecutor) => Promise<string[]>;
  verifyTurnstile: (req: Request, token: string | null) => Promise<void>;
};
export function createMessageOperations(options: MessageOperationOptions) {
  const { storage, ready, now } = options;
  async function consumeRateLimit(req: Request, fingerprint: string | null) {
    const ip = options.getClientIp(req);
    const rules = [
      { key: `mail:ip:min:${ip}`, max: 5, windowMs: 60_000 },
      { key: `mail:ip:hour:${ip}`, max: 20, windowMs: 3_600_000 },
    ];
    if (fingerprint)
      rules.push({
        key: `mail:fp:hour:${fingerprint}`,
        max: 30,
        windowMs: 3_600_000,
      });
    await storage.transaction(async (db) => {
      const stamp = now();
      await db.run("DELETE FROM mail_rate_limit_hits WHERE hit_at<=?", [
        stamp - 86_400_000,
      ]);
      for (const rule of rules) {
        const count = await db.get<{ count: number; first: number }>(
          "SELECT COUNT(*) AS count,MIN(hit_at) AS first FROM mail_rate_limit_hits WHERE scope_key=? AND hit_at>?",
          [rule.key, stamp - rule.windowMs],
        );
        if (Number(count?.count ?? 0) >= rule.max) {
          const retry = Math.max(
            1,
            Number(count!.first) + rule.windowMs - stamp,
          );
          throw new WindChimeError(
            "RATE_LIMITED",
            429,
            "发信过于频繁，请稍后重试",
            retry,
          );
        }
      }
      for (const rule of rules)
        await db.run(
          "INSERT INTO mail_rate_limit_hits(scope_key,hit_at) VALUES(?,?)",
          [rule.key, stamp],
        );
    });
  }
  async function submitMessage(
    payload: unknown,
    req: Request,
  ): Promise<{ ok: true }> {
    const input = objectInput(payload);
    onlyFields(input, [
      "text",
      "nickname",
      "linkUrl",
      "senderFingerprint",
      "turnstileToken",
      "topicSlug",
    ]);
    const normalized = validateWindChimeSubmission(
      input as WindChimeSubmitPayload,
    );
    const { text, nickname, linkUrl } = normalized;
    const fingerprint = textInput(input.senderFingerprint, 512, "发送者指纹");
    const token = textInput(input.turnstileToken, 4096, "人机校验令牌");
    const slug = textInput(input.topicSlug, 64, "话题") ?? "default";
    await ready();
    await consumeRateLimit(req, fingerprint);
    await options.verifyTurnstile(req, token);
    return storage.transaction(async (db) => {
      const topic = await resolveTopic(db, slug, now());
      if (topic.archivedAt) fail("TOPIC_ARCHIVED", "活动已结束", 423);
      if (!topic.isEnabled) fail("TOPIC_DISABLED", "发信箱暂时关闭", 423);
      if (topic.startsAt && now() < Date.parse(topic.startsAt))
        fail("TOPIC_NOT_STARTED", "活动还未开始", 423);
      if (topic.endsAt && now() > Date.parse(topic.endsAt))
        fail("TOPIC_ENDED", "活动已结束", 423);
      const { hash, label } = computeWindChimeSenderIdentity(
        req,
        fingerprint,
        options.hashSalt,
        options.getClientIp,
      );
      // Same public status/body for dropped and saved submissions, so the blocklist is not observable.
      if (await db.get("SELECT hash FROM mail_blocklist WHERE hash=?", [hash]))
        return { ok: true };
      const terms = await options.getBlockedTerms(db);
      const flagged =
        matchWindChimeBlockedTerm(terms, text, nickname, linkUrl) !== null;
      await db.run(
        "INSERT INTO mail_messages(id,created_at,text,nickname,link_url,is_flagged,sender_hash,sender_label,topic_id) VALUES(?,?,?,?,?,?,?,?,?)",
        [
          randomUUID(),
          new Date(now()).toISOString(),
          text,
          nickname,
          linkUrl,
          flagged ? 1 : 0,
          hash,
          label,
          topic.id,
        ],
      );
      return { ok: true };
    });
  }
  async function listMessages(
    options: { topicId?: string; filter?: WindChimeInboxFilter } = {},
  ): Promise<WindChimeMessageList> {
    const filter = options.filter ?? "all";
    if (!isWindChimeInboxFilter(filter)) fail("INVALID_FILTER", "未知信件筛选");
    await ready();
    return storage.transaction(async (db) => {
      const scope = options.topicId ?? "default";
      const topic =
        scope === "all" ? null : await resolveTopic(db, scope, now());
      const where = "deleted_at IS NULL" + (topic ? " AND topic_id=?" : "");
      const params = topic ? [topic.id] : [];
      const counts = await db.get<{
        all_count: number;
        unread_count: number;
        favorited_count: number;
        flagged_count: number;
      }>(
        `SELECT COALESCE(SUM(CASE WHEN is_flagged=0 THEN 1 ELSE 0 END),0) AS all_count, COALESCE(SUM(CASE WHEN is_flagged=0 AND is_read=0 THEN 1 ELSE 0 END),0) AS unread_count, COALESCE(SUM(CASE WHEN is_flagged=0 AND is_favorited=1 THEN 1 ELSE 0 END),0) AS favorited_count, COALESCE(SUM(CASE WHEN is_flagged=1 THEN 1 ELSE 0 END),0) AS flagged_count FROM mail_messages WHERE ${where}`,
        params,
      );
      const filterSql =
        filter === "flagged"
          ? "is_flagged=1"
          : `is_flagged=0${filter === "unread" ? " AND is_read=0" : filter === "favorited" ? " AND is_favorited=1" : ""}`;
      const rows = await db.all<MessageRow>(
        `SELECT * FROM mail_messages WHERE ${where} AND ${filterSql} ORDER BY created_at DESC,id DESC`,
        params,
      );
      return {
        items: rows.map((row) => messageDto(row)),
        counts: {
          all: Number(counts?.all_count ?? 0),
          unread: Number(counts?.unread_count ?? 0),
          favorited: Number(counts?.favorited_count ?? 0),
          flagged: Number(counts?.flagged_count ?? 0),
        },
      };
    });
  }
  async function getMessage(
    id: string,
    topicId = "default",
  ): Promise<WindChimeMessageRecord> {
    await ready();
    return storage.transaction(async (db) =>
      messageDto(await requireMessage(db, id, topicId, now()), true),
    );
  }
  async function updateMessage(
    id: string,
    patch: { isRead?: boolean; isFavorited?: boolean; isFlagged?: boolean },
    topicId = "default",
  ) {
    const raw = objectInput(patch);
    onlyFields(raw, ["isRead", "isFavorited", "isFlagged"]);
    const sets: string[] = [],
      params: unknown[] = [];
    for (const [key, column] of [
      ["isRead", "is_read"],
      ["isFavorited", "is_favorited"],
      ["isFlagged", "is_flagged"],
    ])
      if (key in raw) {
        sets.push(`${column}=?`);
        params.push(boolInput(raw[key], key) ? 1 : 0);
      }
    if (!sets.length) fail("NO_UPDATE", "无更新字段");
    await ready();
    return storage.transaction(async (db) => {
      const row = await requireMessage(db, id, topicId, now());
      await db.run(
        `UPDATE mail_messages SET ${sets.join(",")} WHERE id=? AND topic_id=?`,
        [...params, row.id, row.topic_id],
      );
      return { ok: true as const };
    });
  }
  async function deleteMessage(id: string, topicId = "default") {
    await ready();
    return storage.transaction(async (db) => {
      const row = await requireMessage(db, id, topicId, now());
      await db.run("UPDATE mail_messages SET deleted_at=? WHERE id=?", [
        new Date(now()).toISOString(),
        row.id,
      ]);
      return { ok: true as const };
    });
  }
  async function batchMessages(
    input: { action: "delete" | "markRead"; ids: string[] },
    topicId = "default",
  ) {
    const raw = objectInput(input);
    onlyFields(raw, ["action", "ids"]);
    if (!["delete", "markRead"].includes(raw.action as string))
      fail("INVALID_ACTION", "不支持的批量操作");
    if (
      !Array.isArray(raw.ids) ||
      !raw.ids.length ||
      raw.ids.length > 500 ||
      raw.ids.some((id) => typeof id !== "string" || !id)
    )
      fail("INVALID_IDS", "请选择 1 至 500 封信件");
    const ids = [...new Set(raw.ids as string[])];
    await ready();
    return storage.transaction(async (db) => {
      const topic = await resolveTopic(db, topicId, now());
      const placeholders = ids.map(() => "?").join(",");
      const found = await db.all<{ id: string }>(
        `SELECT id FROM mail_messages WHERE id IN(${placeholders}) AND topic_id=? AND deleted_at IS NULL`,
        [...ids, topic.id],
      );
      if (found.length !== ids.length)
        fail("MESSAGE_NOT_FOUND", "部分信件不存在或不属于当前话题", 404);
      const set = raw.action === "delete" ? "deleted_at=?" : "is_read=1";
      const params =
        raw.action === "delete"
          ? [new Date(now()).toISOString(), ...ids, topic.id]
          : [...ids, topic.id];
      await db.run(
        `UPDATE mail_messages SET ${set} WHERE id IN(${placeholders}) AND topic_id=?`,
        params,
      );
      return { ok: true as const };
    });
  }
  async function blockSender(id: string, topicId = "default") {
    await ready();
    return storage.transaction(async (db) => {
      const row = await requireMessage(db, id, topicId, now());
      if (!row.sender_hash)
        fail("MISSING_SENDER", "该留言缺少发送者指纹，无法屏蔽");
      const stamp = new Date(now()).toISOString();
      await db.run(
        "INSERT INTO mail_blocklist(hash,label,blocked_at,sample_text) VALUES(?,?,?,?) ON CONFLICT(hash) DO UPDATE SET label=excluded.label,blocked_at=excluded.blocked_at,sample_text=excluded.sample_text",
        [
          row.sender_hash,
          row.sender_label,
          stamp,
          row.is_flagged ? null : row.text.slice(0, 80),
        ],
      );
      await db.run(
        "UPDATE mail_messages SET deleted_at=? WHERE sender_hash=? AND deleted_at IS NULL",
        [stamp, row.sender_hash],
      );
      return { ok: true as const };
    });
  }
  return {
    submitMessage,
    listMessages,
    getMessage,
    updateMessage,
    deleteMessage,
    batchMessages,
    blockSender,
  };
}
