import type { WindChimeSqlExecutor } from "./index.js";

/** Called inside the existing schema transaction. No existing message becomes approved. */
export async function initializeWindChimeLiveSchema(db: WindChimeSqlExecutor) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS mail_live_identity (id INTEGER PRIMARY KEY CHECK(id=1), site_id TEXT NOT NULL)`,
    `INSERT OR IGNORE INTO mail_live_identity(id,site_id) VALUES(1,lower(hex(randomblob(24))))`,
    `CREATE TABLE IF NOT EXISTS mail_live_channels (topic_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, activation INTEGER NOT NULL DEFAULT 0, current_snapshot TEXT, last_shown TEXT, runtime_epoch TEXT, appearance TEXT NOT NULL DEFAULT '{}')`,
    `CREATE TABLE IF NOT EXISTS mail_live_drafts (message_id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, source_hash TEXT NOT NULL, draft_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'pending', snapshot_id TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_live_drafts_topic ON mail_live_drafts(topic_id)`,
    `CREATE TABLE IF NOT EXISTS mail_live_snapshots (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, topic_id TEXT NOT NULL, source_hash TEXT NOT NULL, draft_revision INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS mail_live_queue (message_id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, position INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_live_queue_order ON mail_live_queue(topic_id,position)`,
    `CREATE TABLE IF NOT EXISTS mail_live_assets (id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, message_id TEXT, purpose TEXT NOT NULL DEFAULT 'source', ordinal INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL, mime_type TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL, receipt_hash TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_live_assets_message ON mail_live_assets(message_id,ordinal)`,
    `CREATE TABLE IF NOT EXISTS mail_live_grants (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, topic_id TEXT NOT NULL, label TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, binding_id TEXT, platform_session TEXT, parent_grant_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS mail_live_devices (device_hash TEXT PRIMARY KEY, user_code TEXT NOT NULL UNIQUE, device_name TEXT NOT NULL, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL, topic_id TEXT, consumed_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS mail_live_operations (operation_id TEXT NOT NULL, topic_id TEXT NOT NULL, input_hash TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(operation_id,topic_id))`,
    `CREATE TABLE IF NOT EXISTS mail_live_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, message_id TEXT, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS mail_live_nonces (nonce_hash TEXT PRIMARY KEY, topic_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS mail_live_proofs (jti TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS mail_live_bindings (topic_id TEXT PRIMARY KEY, binding_id TEXT NOT NULL UNIQUE, bili_subject TEXT NOT NULL, session_id TEXT NOT NULL)`,
    `CREATE TRIGGER IF NOT EXISTS live_snapshot_immutable BEFORE UPDATE ON mail_live_snapshots BEGIN SELECT RAISE(ABORT,'Live snapshots are immutable'); END`,
    `CREATE TRIGGER IF NOT EXISTS live_asset_immutable BEFORE UPDATE OF sha256,mime_type,width,height,size,topic_id ON mail_live_assets BEGIN SELECT RAISE(ABORT,'Live assets are immutable'); END`,
  ];
  for (const sql of statements) await db.run(sql);
  // Permit a safe additive upgrade from an early 0.6 local development database.
  const grantColumns = new Set((await db.all<{name:string}>("PRAGMA table_info(mail_live_grants)")).map((r) => r.name));
  if (!grantColumns.has("parent_grant_id")) await db.run("ALTER TABLE mail_live_grants ADD COLUMN parent_grant_id TEXT");
  const assetColumns = new Set((await db.all<{name:string}>("PRAGMA table_info(mail_live_assets)")).map((r) => r.name));
  if (!assetColumns.has("purpose")) await db.run("ALTER TABLE mail_live_assets ADD COLUMN purpose TEXT NOT NULL DEFAULT 'source'");
  await db.run(`CREATE TRIGGER IF NOT EXISTS live_asset_purpose_immutable BEFORE UPDATE OF purpose ON mail_live_assets BEGIN SELECT RAISE(ABORT,'Live asset purpose is immutable'); END`);
  await db.run(`CREATE TRIGGER IF NOT EXISTS live_grant_revoked AFTER UPDATE OF revoked_at ON mail_live_grants
    WHEN NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL BEGIN
    UPDATE mail_live_grants SET revoked_at=NEW.revoked_at WHERE parent_grant_id=OLD.id AND revoked_at IS NULL;
    END`);
  // SQL triggers also cover old host writes, batch deletion, sender blocking and topic purge.
  const invalidateMessage = `
    UPDATE mail_live_channels SET revision=revision+1, activation=activation+1,
      current_snapshot=NULL WHERE topic_id=OLD.topic_id;
    DELETE FROM mail_live_queue WHERE message_id=OLD.id;
    UPDATE mail_live_drafts SET status='pending', snapshot_id=NULL, revision=revision+1 WHERE message_id=OLD.id;`;
  await db.run(`CREATE TRIGGER IF NOT EXISTS live_message_changed AFTER UPDATE ON mail_messages
    WHEN OLD.text IS NOT NEW.text OR OLD.nickname IS NOT NEW.nickname OR OLD.link_url IS NOT NEW.link_url
      OR OLD.topic_id IS NOT NEW.topic_id OR OLD.deleted_at IS NOT NEW.deleted_at
      OR (NEW.is_flagged=1 AND OLD.is_flagged<>1)
    BEGIN ${invalidateMessage} END`);
  await db.run(`CREATE TRIGGER IF NOT EXISTS live_message_deleted AFTER DELETE ON mail_messages BEGIN
    ${invalidateMessage}
    DELETE FROM mail_live_drafts WHERE message_id=OLD.id;
    DELETE FROM mail_live_snapshots WHERE message_id=OLD.id;
    DELETE FROM mail_live_assets WHERE message_id=OLD.id;
    END`);
  await db.run(`CREATE TRIGGER IF NOT EXISTS live_topic_archived AFTER UPDATE OF archived_at ON mail_topics
    WHEN NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL BEGIN
    UPDATE mail_live_channels SET revision=revision+1,activation=activation+1,current_snapshot=NULL WHERE topic_id=OLD.id;
    DELETE FROM mail_live_queue WHERE topic_id=OLD.id;
    UPDATE mail_live_drafts SET status='pending',snapshot_id=NULL,revision=revision+1 WHERE topic_id=OLD.id;
    END`);
  await db.run(`CREATE TRIGGER IF NOT EXISTS live_topic_deleted AFTER DELETE ON mail_topics BEGIN
    DELETE FROM mail_live_channels WHERE topic_id=OLD.id;
    DELETE FROM mail_live_queue WHERE topic_id=OLD.id;
    DELETE FROM mail_live_grants WHERE topic_id=OLD.id;
    DELETE FROM mail_live_bindings WHERE topic_id=OLD.id;
    END`);
  await db.run("INSERT OR IGNORE INTO windchime_migrations(id,applied_at) VALUES('0.6.0-live',?)", [new Date().toISOString()]);
}
