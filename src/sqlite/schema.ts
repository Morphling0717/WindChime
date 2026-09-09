import type { WindChimeSqlExecutor } from "./index.js";

// Only mailbox-owned objects. Host schema_migrations, admin sessions and login failures are untouched.
const columns: Record<string, Record<string, string>> = {
  mail_messages: {
    id: "TEXT PRIMARY KEY NOT NULL",
    created_at: "TEXT NOT NULL",
    text: "TEXT NOT NULL",
    nickname: "TEXT",
    link_url: "TEXT",
    deleted_at: "TEXT",
    is_read: "INTEGER NOT NULL DEFAULT 0",
    is_favorited: "INTEGER NOT NULL DEFAULT 0",
    is_flagged: "INTEGER NOT NULL DEFAULT 0",
    sender_hash: "TEXT",
    sender_label: "TEXT",
    topic_id: "TEXT NOT NULL DEFAULT 'default'",
  },
  mail_topics: {
    id: "TEXT PRIMARY KEY NOT NULL",
    slug: "TEXT UNIQUE NOT NULL",
    title: "TEXT NOT NULL",
    description: "TEXT",
    note: "TEXT",
    is_default: "INTEGER NOT NULL DEFAULT 0",
    is_enabled: "INTEGER NOT NULL DEFAULT 1",
    starts_at: "TEXT",
    ends_at: "TEXT",
    archived_at: "TEXT",
    sort_order: "INTEGER NOT NULL DEFAULT 0",
    created_at: "TEXT NOT NULL",
    updated_at: "TEXT NOT NULL",
  },
  mail_blocklist: {
    hash: "TEXT PRIMARY KEY NOT NULL",
    label: "TEXT",
    blocked_at: "TEXT NOT NULL",
    sample_text: "TEXT",
  },
  mail_settings: {
    key: "TEXT PRIMARY KEY NOT NULL",
    value: "TEXT NOT NULL",
    updated_at: "TEXT NOT NULL DEFAULT ''",
  },
};

export async function initializeWindChimeSchema(
  db: WindChimeSqlExecutor,
  defaultTitle: string,
): Promise<void> {
  await db.run("BEGIN IMMEDIATE");
  try {
    // Backfill columns before creating indices; old hosts did this in the reverse order.
    for (const [table, definitions] of Object.entries(columns)) {
      await db.run(
        `CREATE TABLE IF NOT EXISTS ${table} (${Object.entries(definitions)
          .map(([name, definition]) => `${name} ${definition}`)
          .join(", ")})`,
      );
      const existing = new Set(
        (await db.all<{ name: string }>(`PRAGMA table_info(${table})`)).map(
          (row) => row.name,
        ),
      );
      for (const [name, definition] of Object.entries(definitions)) {
        if (!existing.has(name)) {
          if (/PRIMARY KEY|UNIQUE|NOT NULL$/.test(definition))
            throw new Error(
              `Unsupported legacy schema: ${table}.${name} is missing; restore from backup or provide a reviewed migration.`,
            );
          await db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
        }
      }
    }
    await db.run(
      "CREATE INDEX IF NOT EXISTS idx_mail_messages_created_at ON mail_messages(created_at)",
    );
    await db.run(
      "CREATE INDEX IF NOT EXISTS idx_mail_messages_topic_created ON mail_messages(topic_id, deleted_at, created_at)",
    );
    await db.run(
      "CREATE INDEX IF NOT EXISTS idx_mail_messages_topic_unread ON mail_messages(topic_id, is_read) WHERE deleted_at IS NULL",
    );
    await db.run(
      "CREATE INDEX IF NOT EXISTS idx_mail_messages_sender ON mail_messages(sender_hash)",
    );
    await db.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_topics_slug ON mail_topics(slug)",
    );
    await db.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_topics_one_default ON mail_topics(is_default) WHERE is_default = 1",
    );
    // Separate limiter table to avoid transactions/GC from host login code. Existing submission hits are copied once below.
    await db.run(
      "CREATE TABLE IF NOT EXISTS mail_rate_limit_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, scope_key TEXT NOT NULL, hit_at INTEGER NOT NULL)",
    );
    await db.run(
      "CREATE INDEX IF NOT EXISTS idx_mail_rate_limit_hits_key_time ON mail_rate_limit_hits(scope_key, hit_at)",
    );
    await db.run(
      "CREATE TABLE IF NOT EXISTS windchime_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)",
    );
    const defaults = await db.all<{
      id: string;
      slug: string;
      is_default: number;
    }>(
      "SELECT id,slug,is_default FROM mail_topics WHERE is_default = 1 OR id = 'default' OR slug = 'default'",
    );
    if (
      defaults.length > 1 ||
      (defaults.length === 1 &&
        (defaults[0].id !== "default" ||
          defaults[0].slug !== "default" ||
          defaults[0].is_default !== 1))
    )
      throw new Error(
        "Unsupported legacy default topic identity; migration stopped without rewriting existing data.",
      );
    const existingDefault = defaults[0];
    if (!existingDefault) {
      const setting = await db.get<{ value: string }>(
        "SELECT value FROM mail_settings WHERE key = 'mail.enabled'",
      );
      const enabled = setting && ["0", "false"].includes(setting.value) ? 0 : 1;
      const now = new Date().toISOString();
      await db.run(
        "INSERT INTO mail_topics(id,slug,title,is_default,is_enabled,created_at,updated_at) VALUES('default','default',?,1,?,?,?)",
        [defaultTitle, enabled, now, now],
      );
    }
    const marker = "0.5.0-mailbox";
    if (
      !(await db.get("SELECT id FROM windchime_migrations WHERE id = ?", [
        marker,
      ]))
    ) {
      const hasLegacyRates = await db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='rate_limit_hits'",
      );
      if (hasLegacyRates)
        await db.run(
          "INSERT INTO mail_rate_limit_hits(scope_key, hit_at) SELECT scope_key, hit_at FROM rate_limit_hits WHERE scope_key LIKE 'mail:%'",
        );
      const hasMiaRates = await db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_rate_limits'",
      );
      if (hasMiaRates) {
        const rows = await db.all<{ key: string; timestamps: string }>(
          "SELECT key,timestamps FROM runtime_rate_limits WHERE key LIKE 'mail:%'",
        );
        for (const row of rows) {
          let timestamps: unknown;
          try {
            timestamps = JSON.parse(row.timestamps);
          } catch {
            continue;
          }
          if (Array.isArray(timestamps))
            for (const stamp of timestamps)
              if (typeof stamp === "number" && Number.isFinite(stamp))
                await db.run(
                  "INSERT INTO mail_rate_limit_hits(scope_key,hit_at) VALUES(?,?)",
                  [row.key, stamp],
                );
        }
      }
      await db.run(
        "INSERT INTO windchime_migrations(id,applied_at) VALUES(?,?)",
        [marker, new Date().toISOString()],
      );
    }
    await db.run("COMMIT");
  } catch (error) {
    await db.run("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
