import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const globalForDb = globalThis as unknown as { windchimeSqlite?: Database.Database };

/**
 * 示例用 SQLite：单文件库 + WAL。
 * 表结构与 WindChimeMessageRecord 对齐，并加入读/藏/回复/软删/发送者标签等字段。
 * 生产请改为连接池/托管库，并加上鉴权、限流、Turnstile 服务端校验等。
 */
export function getDb(): Database.Database {
  if (globalForDb.windchimeSqlite) return globalForDb.windchimeSqlite;

  const dir =
    process.env.WINDCHIME_DATA_DIR?.trim() || path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'windchime.db');

  const db = new Database(file);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS windchime_messages (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL,
      text TEXT NOT NULL,
      nickname TEXT,
      link_url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_windchime_messages_created_at
      ON windchime_messages (created_at);

    CREATE TABLE IF NOT EXISTS windchime_blocklist (
      hash TEXT PRIMARY KEY NOT NULL,
      label TEXT,
      blocked_at TEXT NOT NULL,
      sample_text TEXT
    );

    CREATE TABLE IF NOT EXISTS windchime_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // —— 在线迁移：对旧库增加字段（IF NOT EXISTS 语义不被支持，用 try/catch）。
  const cols = [
    "ALTER TABLE windchime_messages ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE windchime_messages ADD COLUMN is_favorited INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE windchime_messages ADD COLUMN is_replied INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE windchime_messages ADD COLUMN reply_text TEXT",
    "ALTER TABLE windchime_messages ADD COLUMN sender_hash TEXT",
    "ALTER TABLE windchime_messages ADD COLUMN sender_label TEXT",
    "ALTER TABLE windchime_messages ADD COLUMN deleted_at TEXT",
  ];
  for (const sql of cols) {
    try {
      db.exec(sql);
    } catch {
      /* 列已存在 */
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_windchime_messages_is_read
      ON windchime_messages (is_read);
    CREATE INDEX IF NOT EXISTS idx_windchime_messages_is_favorited
      ON windchime_messages (is_favorited);
    CREATE INDEX IF NOT EXISTS idx_windchime_messages_sender_hash
      ON windchime_messages (sender_hash);
    CREATE INDEX IF NOT EXISTS idx_windchime_messages_deleted_at
      ON windchime_messages (deleted_at);
  `);

  if (process.env.NODE_ENV !== 'production') {
    globalForDb.windchimeSqlite = db;
  }

  return db;
}

/** 从请求头里拿到一个尽可能稳定的 IP；注意：生产需确认反代设置（只信任可信来源的 XFF） */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return '0.0.0.0';
}

/** 读取布尔型设置；默认返回 defaultValue（默认 true）。 */
export function getBoolSetting(key: string, defaultValue = true): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM windchime_settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  if (!row) return defaultValue;
  return row.value === '1' || row.value === 'true';
}

/** 写入布尔型设置。 */
export function setBoolSetting(key: string, value: boolean): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO windchime_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(key, value ? '1' : '0', new Date().toISOString());
}

/** 标准化的风铃开关 setting key。 */
export const WINDCHIME_ENABLED_KEY = 'windchime.enabled';

/** 计算发送者短标签与稳定 hash。使用 server-side salt 避免纯公开信息反推。 */
export function computeSenderIdentity(
  req: Request,
  fingerprint: string | null | undefined,
): { hash: string; label: string } {
  const ip = getClientIp(req);
  const ua = req.headers.get('user-agent') ?? '';
  const fp = (fingerprint ?? '').trim();
  const salt = process.env.WINDCHIME_HASH_SALT ?? 'windchime-default-salt';
  const raw = `${ip}\n${ua}\n${fp}\n${salt}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const label = `User-${hash.slice(0, 4).toUpperCase()}`;
  return { hash, label };
}
