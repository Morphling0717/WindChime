import { randomUUID } from "node:crypto";
import {
  toWindChimePublicTopic,
  validateWindChimeTopicCreate,
  validateWindChimeTopicPatch,
  type WindChimeAdminTopic,
  type WindChimePublicTopic,
  type WindChimeTopicCreateInput,
  type WindChimeTopicPatchInput,
} from "../core/index.js";
import type {
  WindChimeSqlExecutor,
  WindChimeStorage,
} from "../sqlite/index.js";
import { boolInput, fail, objectInput, timeRange } from "./validation.js";
export type TopicRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  note: string | null;
  is_default: number;
  is_enabled: number;
  starts_at: string | null;
  ends_at: string | null;
  archived_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};
export type ListTopicsOptions = {
  includeArchived?: boolean;
  withCounts?: boolean;
  onlyPublicActive?: boolean;
};
export function rowToTopic(row: TopicRow, now: number): WindChimeAdminTopic {
  const state = row.is_default
    ? "default"
    : row.archived_at
      ? "archived"
      : !row.is_enabled
        ? "ended"
        : row.starts_at && now < Date.parse(row.starts_at)
          ? "scheduled"
          : row.ends_at && now > Date.parse(row.ends_at)
            ? "ended"
            : "active";
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    note: row.note,
    isDefault: !!row.is_default,
    isEnabled: !!row.is_enabled,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    archivedAt: row.archived_at,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state,
    isEnabledNow:
      !row.archived_at &&
      !!row.is_enabled &&
      (!row.starts_at || now >= Date.parse(row.starts_at)) &&
      (!row.ends_at || now <= Date.parse(row.ends_at)),
  };
}
export async function resolveTopic(
  db: WindChimeSqlExecutor,
  idOrSlug: string,
  now: number,
): Promise<WindChimeAdminTopic> {
  const row = await db.get<TopicRow>(
    "SELECT * FROM mail_topics WHERE id = ? OR slug = ? ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1",
    [idOrSlug, idOrSlug, idOrSlug],
  );
  if (!row) fail("TOPIC_NOT_FOUND", "主题不存在", 404);
  return rowToTopic(row, now);
}
export async function topicCounts(db: WindChimeSqlExecutor, topicId: string) {
  const row = await db.get<{ unread: number; flagged: number }>(
    "SELECT COALESCE(SUM(CASE WHEN is_read=0 AND is_flagged=0 THEN 1 ELSE 0 END),0) AS unread, COALESCE(SUM(is_flagged),0) AS flagged FROM mail_messages WHERE topic_id=? AND deleted_at IS NULL",
    [topicId],
  );
  return {
    unreadCount: Number(row?.unread ?? 0),
    flaggedCount: Number(row?.flagged ?? 0),
  };
}
export function createTopicOperations(
  storage: WindChimeStorage,
  ready: () => Promise<void>,
  now: () => number,
) {
  async function getTopicById(id: string) {
    await ready();
    const row = await storage.get<TopicRow>(
      "SELECT * FROM mail_topics WHERE id=?",
      [id],
    );
    return row ? rowToTopic(row, now()) : null;
  }
  async function getTopicBySlug(slug: string) {
    await ready();
    const row = await storage.get<TopicRow>(
      "SELECT * FROM mail_topics WHERE slug=?",
      [slug],
    );
    return row ? rowToTopic(row, now()) : null;
  }
  async function listTopics(
    options: ListTopicsOptions = {},
  ): Promise<WindChimeAdminTopic[]> {
    await ready();
    return storage.transaction(async (db) => {
      const rows = await db.all<TopicRow>(
        `SELECT * FROM mail_topics ${options.includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY is_default DESC, sort_order ASC, created_at ASC`,
      );
      let topics = rows.map((row) => rowToTopic(row, now()));
      if (options.onlyPublicActive)
        topics = topics.filter(
          (topic) => !topic.isDefault && topic.isEnabledNow,
        );
      if (options.withCounts)
        for (const topic of topics)
          Object.assign(topic, await topicCounts(db, topic.id));
      return topics;
    });
  }
  async function createTopic(
    input: WindChimeTopicCreateInput,
  ): Promise<WindChimeAdminTopic> {
    const normalized = validateWindChimeTopicCreate(input);
    const { slug, title, description, note } = normalized;
    const start = normalized.startsAt ?? null,
      end = normalized.endsAt ?? null,
      enabled = normalized.isEnabled!,
      sort = normalized.sortOrder!;
    await ready();
    return storage.transaction(async (db) => {
      if (await db.get("SELECT id FROM mail_topics WHERE slug=?", [slug]))
        fail("SLUG_DUPLICATE", "slug 已被占用", 409);
      const id = randomUUID(),
        stamp = new Date(now()).toISOString();
      await db.run(
        "INSERT INTO mail_topics(id,slug,title,description,note,is_enabled,starts_at,ends_at,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          slug,
          title,
          description,
          note,
          enabled ? 1 : 0,
          start,
          end,
          sort,
          stamp,
          stamp,
        ],
      );
      return resolveTopic(db, id, now());
    });
  }
  async function updateTopic(
    id: string,
    patch: WindChimeTopicPatchInput,
  ): Promise<WindChimeAdminTopic> {
    const raw = objectInput(validateWindChimeTopicPatch(patch));
    await ready();
    return storage.transaction(async (db) => {
      const current = await resolveTopic(db, id, now());
      if (current.archivedAt && raw.archivedAt !== null)
        fail("ARCHIVED_NOT_EDITABLE", "已归档主题请先恢复再编辑", 409);
      if (
        current.isDefault &&
        ["note", "startsAt", "endsAt", "sortOrder", "archivedAt"].some(
          (key) => key in raw,
        )
      )
        fail(
          "DEFAULT_FIELDS_LIMITED",
          "默认主题只能修改 title、description、isEnabled",
        );
      const sets: string[] = [],
        params: unknown[] = [];
      const set = (column: string, value: unknown) => {
        sets.push(`${column}=?`);
        params.push(value);
      };
      if ("title" in raw) set("title", raw.title);
      if ("description" in raw) set("description", raw.description);
      if ("note" in raw) set("note", raw.note);
      if ("isEnabled" in raw) set("is_enabled", raw.isEnabled ? 1 : 0);
      if ("startsAt" in raw) set("starts_at", raw.startsAt as string | null);
      if ("endsAt" in raw) set("ends_at", raw.endsAt as string | null);
      if ("sortOrder" in raw) set("sort_order", raw.sortOrder);
      if ("archivedAt" in raw) set("archived_at", null);
      timeRange(
        "startsAt" in raw ? (raw.startsAt as string | null) : current.startsAt,
        "endsAt" in raw ? (raw.endsAt as string | null) : current.endsAt,
      );
      if (sets.length) {
        set("updated_at", new Date(now()).toISOString());
        await db.run(`UPDATE mail_topics SET ${sets.join(",")} WHERE id=?`, [
          ...params,
          current.id,
        ]);
      }
      return resolveTopic(db, current.id, now());
    });
  }
  async function archiveTopic(
    id: string,
    options: { markReadFirst?: boolean } = {},
  ) {
    if (options.markReadFirst !== undefined)
      boolInput(options.markReadFirst, "markReadFirst");
    await ready();
    return storage.transaction(async (db) => {
      const current = await resolveTopic(db, id, now());
      if (current.isDefault) fail("DEFAULT_NOT_ARCHIVABLE", "默认主题不可归档");
      if (options.markReadFirst)
        await db.run(
          "UPDATE mail_messages SET is_read=1 WHERE topic_id=? AND deleted_at IS NULL AND is_flagged=0",
          [current.id],
        );
      const counts = await topicCounts(db, current.id);
      if (!current.archivedAt) {
        const stamp = new Date(now()).toISOString();
        await db.run(
          "UPDATE mail_topics SET archived_at=?,updated_at=? WHERE id=?",
          [stamp, stamp, current.id],
        );
      }
      return { topic: await resolveTopic(db, current.id, now()), ...counts };
    });
  }
  async function deleteArchivedTopic(id: string) {
    await ready();
    return storage.transaction(async (db) => {
      const current = await resolveTopic(db, id, now());
      if (current.isDefault) fail("DEFAULT_NOT_DELETABLE", "默认主题不可删除");
      if (!current.archivedAt)
        fail("TOPIC_NOT_ARCHIVED", "仅已归档主题可永久删除", 409);
      await db.run("DELETE FROM mail_messages WHERE topic_id=?", [current.id]);
      await db.run("DELETE FROM mail_topics WHERE id=?", [current.id]);
      return current;
    });
  }
  return {
    getTopicById,
    getTopicBySlug,
    getDefaultTopic: () => getTopicById("default"),
    listTopics,
    createTopic,
    updateTopic,
    archiveTopic,
    restoreTopic: (id: string) => updateTopic(id, { archivedAt: null }),
    deleteArchivedTopic,
    getTopicCounts: async (id: string) => {
      await ready();
      return storage.transaction(async (db) =>
        topicCounts(db, (await resolveTopic(db, id, now())).id),
      );
    },
    listPublicTopics: async (): Promise<WindChimePublicTopic[]> =>
      (await listTopics({ onlyPublicActive: true })).map(
        toWindChimePublicTopic,
      ),
    getPublicTopic: async (
      idOrSlug: string,
    ): Promise<WindChimePublicTopic | null> => {
      const topic =
        (await getTopicById(idOrSlug)) ?? (await getTopicBySlug(idOrSlug));
      return topic ? toWindChimePublicTopic(topic) : null;
    },
  };
}
