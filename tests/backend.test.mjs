import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sqlite3 from "sqlite3";
import { createWindChimeSqlite } from "../dist/sqlite/index.js";
import {
  createWindChimeService,
  computeWindChimeSenderIdentity,
  getWindChimeClientIp,
} from "../dist/server/index.js";
import { createWindChimeRouteHandlers } from "../dist/next/index.js";
import {
  validateWindChimeSubmission,
  toWindChimePublicTopic,
} from "../dist/core/index.js";

async function rawDb(filename, sql) {
  const db = new sqlite3.Database(filename);
  await new Promise((resolve, reject) =>
    db.exec(sql, (error) => (error ? reject(error) : resolve())),
  );
  await new Promise((resolve, reject) =>
    db.close((error) => (error ? reject(error) : resolve())),
  );
}
async function fixture(
  t,
  { legacy, now = Date.parse("2026-09-09T12:00:00Z"), ...options } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "windchime-test-")),
    filename = join(dir, "test.sqlite");
  if (legacy) await rawDb(filename, legacy);
  const storage = createWindChimeSqlite({ filename });
  t.after(async () => {
    await storage.close();
    await rm(dir, { recursive: true, force: true });
  });
  const service = createWindChimeService({
    storage,
    hashSalt: "stable-test-salt",
    now: () => now,
    ...options,
  });
  await service.ready();
  const handlers = createWindChimeRouteHandlers({
    service,
    authorizeAdmin: (req) =>
      req.headers.get("x-test-admin") === "yes"
        ? null
        : Response.json({ error: "login" }, { status: 401 }),
    hasAdminAccess: (req) => req.headers.get("x-test-admin") === "yes",
  });
  const request = (
    path,
    method = "GET",
    payload,
    admin = true,
    ip = "127.0.0.1",
  ) =>
    new Request("http://test/api/mail" + path, {
      method,
      headers: {
        ...(admin ? { "x-test-admin": "yes" } : {}),
        "content-type": "application/json",
        "x-real-ip": ip,
        "user-agent": "test-agent",
      },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
  const call = (path, method = "GET", payload, admin = true, ip) =>
    handlers[method](request(path, method, payload, admin, ip));
  return { dir, filename, storage, service, request, call, handlers };
}
const earlierSchema = `
CREATE TABLE host_users(id TEXT PRIMARY KEY,password_hash TEXT);INSERT INTO host_users VALUES('admin','keep-me');
CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT);INSERT INTO schema_migrations VALUES('host-before','2024-01-01');
CREATE TABLE mail_messages(id TEXT PRIMARY KEY NOT NULL,created_at TEXT NOT NULL,text TEXT NOT NULL,nickname TEXT,link_url TEXT,deleted_at TEXT,is_read INTEGER NOT NULL DEFAULT 0,is_favorited INTEGER NOT NULL DEFAULT 0,sender_hash TEXT,sender_label TEXT);
INSERT INTO mail_messages VALUES('old','2024-01-02T03:04:05Z','keep text','nick','https://example.com',NULL,1,1,'unchanged-hash','User-1234');
CREATE TABLE mail_settings(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL);INSERT INTO mail_settings VALUES('mail.enabled','false','2024-01-01');INSERT INTO mail_settings VALUES('mail.blocked_terms','[" SECRET "]','2024-01-01');
CREATE TABLE mail_blocklist(hash TEXT PRIMARY KEY NOT NULL,label TEXT,blocked_at TEXT NOT NULL,sample_text TEXT);INSERT INTO mail_blocklist VALUES('already-blocked','User-4321','2024-02-01','sample');
CREATE TABLE rate_limit_hits(id INTEGER PRIMARY KEY AUTOINCREMENT,scope_key TEXT NOT NULL,hit_at INTEGER NOT NULL);INSERT INTO rate_limit_hits(scope_key,hit_at) VALUES('mail:ip:min:127.0.0.1',100),('login:ip:x',200);
CREATE TABLE login_failures(ip TEXT PRIMARY KEY,count INTEGER,first_fail_at INTEGER,locked_until INTEGER);INSERT INTO login_failures VALUES('x',4,5,6);
`;

test("new database initializes default and independent migration record; service waits for host readiness", async (t) => {
  let hostReadyCalls = 0;
  const f = await fixture(t, {
    ready: async () => {
      hostReadyCalls++;
    },
  });
  assert.equal((await f.service.getDefaultTopic()).id, "default");
  assert.equal((await f.service.getSettings()).enabled, true);
  assert.equal(
    (await f.storage.all("SELECT * FROM windchime_migrations")).length,
    1,
  );
  assert.ok(hostReadyCalls >= 3);
  assert.equal(
    await f.storage.get(
      "SELECT name FROM sqlite_master WHERE name='schema_migrations'",
    ),
    undefined,
  );
});

test("pre-topic schema migrates before indices, preserves old data/settings/hash and does not touch host login", async (t) => {
  const f = await fixture(t, { legacy: earlierSchema });
  const old = await f.storage.get("SELECT * FROM mail_messages WHERE id=?", [
    "old",
  ]);
  assert.equal(old.topic_id, "default");
  assert.equal(old.is_flagged, 0);
  assert.equal(old.sender_hash, "unchanged-hash");
  assert.equal(old.is_read, 1);
  assert.equal(old.is_favorited, 1);
  assert.equal(old.created_at, "2024-01-02T03:04:05Z");
  assert.equal(old.text, "keep text");
  assert.deepEqual(await f.service.getSettings(), { enabled: false });
  assert.deepEqual(await f.service.getBlockedTerms(), ["secret"]);
  assert.deepEqual(await f.storage.get("SELECT * FROM host_users"), {
    id: "admin",
    password_hash: "keep-me",
  });
  assert.deepEqual(await f.storage.get("SELECT * FROM login_failures"), {
    ip: "x",
    count: 4,
    first_fail_at: 5,
    locked_until: 6,
  });
  assert.equal(
    (await f.storage.all("SELECT * FROM schema_migrations")).length,
    1,
  );
  assert.equal(
    (await f.storage.all("SELECT * FROM mail_rate_limit_hits")).length,
    1,
  );
  const second = createWindChimeSqlite({ filename: f.filename });
  await second.ready;
  assert.equal(
    (await second.all("SELECT * FROM windchime_migrations")).length,
    1,
  );
  assert.equal(
    (await second.all("SELECT * FROM mail_rate_limit_hits")).length,
    1,
  );
  await second.close();
});

// Both hosts' checked-in mailbox schema at migration start, without relying on the
// new adapter to create these tables. Host-specific limiter layouts are tested separately.
const currentSchema =
  earlierSchema +
  `
ALTER TABLE mail_messages ADD COLUMN topic_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE mail_messages ADD COLUMN is_flagged INTEGER NOT NULL DEFAULT 0;
CREATE TABLE mail_topics(id TEXT PRIMARY KEY NOT NULL,slug TEXT UNIQUE NOT NULL,title TEXT NOT NULL,description TEXT,note TEXT,is_default INTEGER NOT NULL DEFAULT 0,is_enabled INTEGER NOT NULL DEFAULT 1,starts_at TEXT,ends_at TEXT,archived_at TEXT,sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
INSERT INTO mail_topics VALUES('default','default','Original default',NULL,NULL,1,0,NULL,NULL,NULL,0,'2024-01-01','2024-01-01');
INSERT INTO mail_topics VALUES('legacy-topic','legacy-event','Original event','Description','Internal note',0,1,'2024-01-01T00:00:00Z','2024-12-01T00:00:00Z','2025-01-01T00:00:00Z',7,'2024-01-01T00:00:00Z','2025-01-01T00:00:00Z');
UPDATE mail_messages SET topic_id='legacy-topic',is_flagged=1,deleted_at='2025-01-01T00:00:00Z' WHERE id='old';
CREATE UNIQUE INDEX idx_mail_topics_one_default ON mail_topics(is_default) WHERE is_default=1;
CREATE INDEX idx_mail_messages_topic_created ON mail_messages(topic_id,deleted_at,created_at);
`;

for (const host of ["UliUli", "Mia"])
  test(`${host} current schema round-trips all topic/message state across restart`, async (t) => {
    const f = await fixture(t, { legacy: currentSchema });
    const topic = await f.service.createTopic({
      slug: "campaign",
      title: "Original",
      description: "Public",
      note: "Private",
      sortOrder: 3,
      startsAt: "2026-01-01T00:00:00+08:00",
      endsAt: "2027-01-01T00:00:00Z",
    });
    assert.equal((await f.service.getDefaultTopic()).title, "Original default");
    const preserved = await f.service.getTopicById("legacy-topic");
    assert.equal(preserved.note, "Internal note");
    assert.equal(preserved.slug, "legacy-event");
    assert.equal(preserved.archivedAt, "2025-01-01T00:00:00Z");
    assert.equal(preserved.sortOrder, 7);
    const preservedMessage = await f.storage.get(
      "SELECT * FROM mail_messages WHERE id=?",
      ["old"],
    );
    assert.equal(preservedMessage.topic_id, "legacy-topic");
    assert.equal(preservedMessage.sender_hash, "unchanged-hash");
    assert.equal(preservedMessage.deleted_at, "2025-01-01T00:00:00Z");
    assert.equal(preservedMessage.is_flagged, 1);
    await f.storage.run(
      "INSERT INTO mail_messages(id,topic_id,created_at,text,is_read,is_favorited,is_flagged,deleted_at,sender_hash,sender_label) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [
        "kept",
        topic.id,
        "2026-09-01T00:00:00Z",
        "flagged source",
        1,
        1,
        1,
        "2026-09-02T00:00:00Z",
        "legacy-hash",
        "User-1234",
      ],
    );
    await f.service.archiveTopic(topic.id);
    const before = await f.storage.get("SELECT * FROM mail_topics WHERE id=?", [
      topic.id,
    ]);
    const second = createWindChimeSqlite({ filename: f.filename });
    await second.ready;
    assert.deepEqual(
      await second.get("SELECT * FROM mail_topics WHERE id=?", [topic.id]),
      before,
    );
    const record = await second.get("SELECT * FROM mail_messages WHERE id=?", [
      "kept",
    ]);
    assert.equal(record.topic_id, topic.id);
    assert.equal(record.deleted_at, "2026-09-02T00:00:00Z");
    assert.equal(record.sender_hash, "legacy-hash");
    assert.equal(record.is_flagged, 1);
    await second.close();
  });

test("failed legacy migration rolls back DDL and its migration marker", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "windchime-failed-")),
    filename = join(dir, "test.sqlite");
  await rawDb(
    filename,
    "CREATE TABLE mail_messages(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,text TEXT NOT NULL);CREATE TABLE mail_topics(id TEXT PRIMARY KEY,slug TEXT UNIQUE NOT NULL,title TEXT NOT NULL,is_default INTEGER DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);INSERT INTO mail_topics VALUES('a','a','A',1,'x','x'),('b','b','B',1,'x','x');",
  );
  const storage = createWindChimeSqlite({ filename });
  await assert.rejects(storage.ready, /UNIQUE/);
  await storage.close();
  const db = new sqlite3.Database(filename);
  const columns = await new Promise((resolve, reject) =>
    db.all("PRAGMA table_info(mail_messages)", (error, rows) =>
      error ? reject(error) : resolve(rows),
    ),
  );
  assert.deepEqual(
    columns.map((row) => row.name),
    ["id", "created_at", "text"],
  );
  await new Promise((resolve) => db.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

test("sender identity and proxy precedence exactly preserve both host algorithms", () => {
  const req = new Request("http://test", {
    headers: {
      "cf-connecting-ip": "1.2.3.4",
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3, 4.4.4.4",
      "user-agent": "Agent",
    },
  });
  assert.equal(getWindChimeClientIp(req), "1.2.3.4");
  for (const salt of ["uliuli-mail-default-salt", "mia-mail-default-salt"]) {
    const expected = createHash("sha256")
      .update(`1.2.3.4\nAgent\nfp\n${salt}`)
      .digest("hex");
    assert.deepEqual(computeWindChimeSenderIdentity(req, " fp ", salt), {
      hash: expected,
      label: `User-${expected.slice(0, 4).toUpperCase()}`,
    });
  }
  assert.equal(
    getWindChimeClientIp(
      new Request("http://test", {
        headers: { "x-forwarded-for": "3.3.3.3, 4.4.4.4" },
      }),
    ),
    "4.4.4.4",
  );
});

test("public API and SSR DTO never serialize notes, counts, hashes, or submitted text; all management methods require login", async (t) => {
  const f = await fixture(t);
  await f.service.createTopic({
    slug: "public",
    title: "Event",
    note: "INTERNAL_SECRET",
  });
  for (const topic of [
    ...(await f.service.listPublicTopics()),
    await f.service.getPublicTopic("public"),
  ]) {
    assert.equal("note" in topic, false);
    assert.equal("unreadCount" in topic, false);
    assert.equal("flaggedCount" in topic, false);
  }
  const admin = await f.service.getTopicBySlug("public");
  assert.equal(admin.note, "INTERNAL_SECRET");
  assert.equal(
    "newSecret" in toWindChimePublicTopic({ ...admin, newSecret: "never" }),
    false,
  );
  for (const path of ["/topics", "/topics/public"]) {
    const response = await f.call(path, "GET", undefined, false);
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes("INTERNAL_SECRET"));
  }
  const result = await f.call(
    "/messages",
    "POST",
    { text: "private-text" },
    false,
  );
  assert.equal(result.status, 201);
  assert.deepEqual(await result.json(), { ok: true });
  for (const [path, method, payload] of [
    ["/messages", "GET"],
    ["/messages/id", "GET"],
    ["/messages/id", "PATCH", { isRead: true }],
    ["/messages/id", "DELETE"],
    ["/messages/batch", "POST", { action: "delete", ids: ["id"] }],
    ["/messages/id/block", "POST"],
    ["/topics", "POST", { slug: "x", title: "X" }],
    ["/topics/public", "PATCH", { isEnabled: false }],
    ["/topics/public", "DELETE"],
    ["/topics/public/purge", "DELETE"],
    ["/blocked-terms", "GET"],
    ["/blocked-terms", "PUT", { terms: [] }],
    ["/blocklist", "GET"],
    ["/blocklist/hash", "DELETE"],
    ["/settings", "PUT", { enabled: false }],
  ])
    assert.equal(
      (await f.call(path, method, payload, false)).status,
      401,
      `${method} ${path}`,
    );
});

test("message lifecycle, review redaction, consistent counts, topic isolation, and strict inputs", async (t) => {
  const f = await fixture(t);
  const topic = await f.service.createTopic({ slug: "event", title: "Event" });
  await f.service.setBlockedTerms([" Secret ", "secret"]);
  for (const payload of [
    { text: "normal" },
    {
      text: "contains secret",
      nickname: "secret",
      linkUrl: "https://secret.example",
    },
    { text: "other topic", topicSlug: "event" },
  ])
    assert.equal(
      (await f.call("/messages", "POST", payload, false)).status,
      201,
    );
  const all = await f.service.listMessages();
  assert.equal(all.items.length, 1);
  assert.deepEqual(all.counts, { all: 1, unread: 1, favorited: 0, flagged: 1 });
  const flagged = await f.service.listMessages({ filter: "flagged" });
  assert.equal(flagged.items.length, 1);
  assert.equal(flagged.items[0].text, "");
  assert.equal(flagged.items[0].nickname, null);
  assert.equal(flagged.items[0].linkUrl, null);
  const detail = await f.service.getMessage(flagged.items[0].id);
  assert.equal(detail.text, "contains secret");
  await f.service.updateMessage(detail.id, { isFlagged: false });
  await f.service.updateMessage(all.items[0].id, {
    isRead: true,
    isFavorited: true,
  });
  assert.equal(
    (await f.service.listMessages({ filter: "favorited" })).items.length,
    1,
  );
  assert.equal(
    (await f.service.listMessages({ filter: "unread" })).items.length,
    1,
  );
  assert.equal((await f.service.listMessages()).counts.flagged, 0);
  const foreign = (await f.service.listMessages({ topicId: topic.id }))
    .items[0];
  assert.equal(
    (await f.call(`/messages/${foreign.id}`, "PATCH", { isRead: true })).status,
    404,
  );
  assert.equal(
    (
      await f.call("/messages/batch", "POST", {
        action: "delete",
        ids: [all.items[0].id, foreign.id],
      })
    ).status,
    404,
  );
  assert.equal((await f.service.listMessages()).items.length, 2);
  assert.equal((await f.call("/messages?filter=garbage")).status, 400);
  assert.equal(
    (await f.call(`/messages/${all.items[0].id}`, "PATCH", { isRead: "false" }))
      .status,
    400,
  );
  assert.equal(
    (await f.call("/topics/event", "PATCH", { isEnabled: "false" })).status,
    400,
  );
  assert.equal(
    (await f.call("/topics/event", "PATCH", { archivedAt: "yesterday" }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.call("/topics", "POST", {
        slug: "other",
        title: "Title",
        isDefault: true,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/messages",
        "POST",
        { text: "ok", senderFingerprint: 12 },
        false,
        "invalid",
      )
    ).status,
    400,
  );
  const badJson = new Request("http://test/api/mail/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal((await f.handlers.POST(badJson)).status, 400);
  await f.service.batchMessages({ action: "markRead", ids: [detail.id] });
  assert.equal((await f.service.listMessages()).counts.unread, 0);
  await f.service.deleteMessage(detail.id);
  assert.equal((await f.call(`/messages/${detail.id}`)).status, 404);
});

test("archive markReadFirst addresses the requested topic atomically and leaves flagged items unread; restore and purge retain scope", async (t) => {
  const f = await fixture(t);
  const a = await f.service.createTopic({ slug: "a", title: "A" }),
    b = await f.service.createTopic({ slug: "b", title: "B" });
  await f.service.setBlockedTerms(["review"]);
  for (const [index, payload] of [
    { text: "normal A", topicSlug: "a" },
    { text: "review A", topicSlug: "a" },
    { text: "normal B", topicSlug: "b" },
  ].entries())
    await f.call("/messages", "POST", payload, false, `ip${index}`);
  const res = await f.call("/topics/a", "DELETE", { markReadFirst: true });
  assert.equal(res.status, 200);
  const archived = await res.json();
  assert.equal(archived.unreadCount, 0);
  assert.equal(archived.flaggedCount, 1);
  assert.equal(
    (await f.service.listMessages({ topicId: a.id, filter: "flagged" }))
      .items[0].isRead,
    false,
  );
  assert.equal(
    (await f.service.listMessages({ topicId: b.id })).items[0].isRead,
    false,
  );
  assert.equal((await f.call("/topics/default", "DELETE")).status, 400);
  assert.equal((await f.call("/topics/b/purge", "DELETE")).status, 409);
  await f.service.restoreTopic(a.id);
  assert.equal((await f.service.getTopicById(a.id)).archivedAt, null);
  await f.service.archiveTopic(a.id);
  await f.service.deleteArchivedTopic(a.id);
  assert.equal(await f.service.getTopicById(a.id), null);
  assert.equal(
    (
      await f.storage.all("SELECT * FROM mail_messages WHERE topic_id=?", [
        a.id,
      ])
    ).length,
    0,
  );
  assert.equal(
    (await f.service.listMessages({ topicId: b.id })).items.length,
    1,
  );
});

test("block removes history across topics, dropped submissions are indistinguishable, unblock allows new mail", async (t) => {
  const f = await fixture(t);
  await f.service.createTopic({ slug: "event", title: "Event" });
  await f.call(
    "/messages",
    "POST",
    { text: "first", senderFingerprint: "same" },
    false,
  );
  await f.call(
    "/messages",
    "POST",
    { text: "second", topicSlug: "event", senderFingerprint: "same" },
    false,
  );
  const first = (await f.service.listMessages()).items[0];
  await f.service.blockSender(first.id);
  assert.equal(
    (await f.service.listMessages({ topicId: "all" })).items.length,
    0,
  );
  const blocked = await f.service.listBlockedSenders();
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].sampleText, "first");
  const dropped = await f.call(
    "/messages",
    "POST",
    { text: "third", senderFingerprint: "same" },
    false,
  );
  assert.equal(dropped.status, 201);
  assert.deepEqual(await dropped.json(), { ok: true });
  assert.equal((await f.storage.all("SELECT * FROM mail_messages")).length, 2);
  await f.service.unblockSender(blocked[0].hash);
  await f.call(
    "/messages",
    "POST",
    { text: "fourth", senderFingerprint: "same" },
    false,
  );
  assert.equal((await f.service.listMessages()).items.length, 1);
});

test("transactions roll back failed archive, block and purge without partial writes; operations recover afterwards", async (t) => {
  const f = await fixture(t);
  const topic = await f.service.createTopic({
    slug: "atomic",
    title: "Atomic",
  });
  await f.call(
    "/messages",
    "POST",
    { text: "one", topicSlug: "atomic" },
    false,
  );
  const message = (await f.service.listMessages({ topicId: topic.id }))
    .items[0];
  await f.storage.run(
    "CREATE TRIGGER fail_archive BEFORE UPDATE OF archived_at ON mail_topics BEGIN SELECT RAISE(ABORT,'archive failed'); END",
  );
  await assert.rejects(
    f.service.archiveTopic(topic.id, { markReadFirst: true }),
    /archive failed/,
  );
  assert.equal(
    (await f.service.getMessage(message.id, topic.id)).isRead,
    false,
  );
  await f.storage.run("DROP TRIGGER fail_archive");
  await f.storage.run(
    "CREATE TRIGGER fail_block BEFORE UPDATE OF deleted_at ON mail_messages BEGIN SELECT RAISE(ABORT,'block failed'); END",
  );
  await assert.rejects(
    f.service.blockSender(message.id, topic.id),
    /block failed/,
  );
  assert.equal((await f.service.listBlockedSenders()).length, 0);
  await f.storage.run("DROP TRIGGER fail_block");
  await f.service.archiveTopic(topic.id);
  await f.storage.run(
    "CREATE TRIGGER fail_purge BEFORE DELETE ON mail_topics BEGIN SELECT RAISE(ABORT,'purge failed'); END",
  );
  await assert.rejects(f.service.deleteArchivedTopic(topic.id), /purge failed/);
  assert.equal(
    (
      await f.storage.all("SELECT id FROM mail_messages WHERE topic_id=?", [
        topic.id,
      ])
    ).length,
    1,
  );
  await f.storage.run("DROP TRIGGER fail_purge");
  await f.service.deleteArchivedTopic(topic.id);
});

test("concurrent submissions enforce exact durable limits across eight independent connections", async (t) => {
  const f = await fixture(t);
  const others = Array.from({ length: 7 }, () =>
    createWindChimeSqlite({ filename: f.filename }),
  );
  t.after(async () => {
    await Promise.all(others.map((storage) => storage.close()));
  });
  await Promise.all(others.map((storage) => storage.ready));
  const services = [
    f.service,
    ...others.map((storage) =>
      createWindChimeService({
        storage,
        hashSalt: "stable-test-salt",
        now: () => Date.parse("2026-09-09T12:00:00Z"),
      }),
    ),
  ];
  const results = await Promise.allSettled(
    Array.from({ length: 32 }, (_, index) =>
      services[index % 8].submitMessage(
        { text: `message ${index}` },
        f.request("/messages", "POST", undefined, false),
      ),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    5,
  );
  assert.equal(
    results.filter(
      (result) => result.status === "rejected" && result.reason.status === 429,
    ).length,
    27,
  );
  assert.equal((await f.storage.all("SELECT id FROM mail_messages")).length, 5);
  const response = await f.call("/messages", "POST", { text: "over" }, false);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
});

test("time windows, disabled topics, required Turnstile and verifier failures enforce server decisions", async (t) => {
  const f = await fixture(t);
  await f.service.createTopic({
    slug: "future",
    title: "Future",
    startsAt: "2027-01-01T00:00:00Z",
  });
  await f.service.createTopic({
    slug: "past",
    title: "Past",
    endsAt: "2025-01-01T00:00:00Z",
  });
  await f.service.createTopic({
    slug: "paused",
    title: "Paused",
    isEnabled: false,
  });
  for (const [index, slug] of ["future", "past", "paused"].entries())
    assert.equal(
      (
        await f.call(
          "/messages",
          "POST",
          { text: "test", topicSlug: slug },
          false,
          `ip-${index}`,
        )
      ).status,
      423,
    );
  const ts = await fixture(t, {
    turnstileSecret: "test-secret",
    fetch: async () => Response.json({ success: false }),
  });
  assert.equal(
    (await ts.call("/messages", "POST", { text: "test" }, false)).status,
    403,
  );
  assert.equal(
    (
      await ts.call(
        "/messages",
        "POST",
        { text: "test", turnstileToken: "bad" },
        false,
      )
    ).status,
    403,
  );
  const network = await fixture(t, {
    turnstileSecret: "test-secret",
    fetch: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(
    (
      await network.call(
        "/messages",
        "POST",
        { text: "test", turnstileToken: "token" },
        false,
      )
    ).status,
    502,
  );
  const passed = await fixture(t, {
    turnstileSecret: "test-secret",
    fetch: async (_url, init) => {
      assert.equal(new URLSearchParams(init.body).get("secret"), "test-secret");
      return Response.json({ success: true });
    },
  });
  assert.equal(
    (
      await passed.call(
        "/messages",
        "POST",
        { text: "test", turnstileToken: "token" },
        false,
      )
    ).status,
    201,
  );
});

test("shared submission normalization validates text and safe HTTP URLs identically for server and hooks", () => {
  assert.deepEqual(
    validateWindChimeSubmission({
      text: " hi ",
      nickname: " N ",
      linkUrl: "example.com",
    }),
    { text: "hi", nickname: "N", linkUrl: "https://example.com/" },
  );
  for (const value of [
    { text: "" },
    { text: "x".repeat(1001) },
    { text: "ok", nickname: 123 },
    { text: "ok", linkUrl: "javascript:alert(1)" },
    { text: "ok", linkUrl: "ftp://example.com" },
  ])
    assert.throws(() => validateWindChimeSubmission(value));
});

test("Mia JSON rate-limit state migrates once without changing login or original rate tables", async (t) => {
  const stamp = Date.parse("2026-09-09T12:00:00Z");
  const legacy = `CREATE TABLE runtime_rate_limits(key TEXT PRIMARY KEY NOT NULL,timestamps TEXT NOT NULL,updated_at TEXT NOT NULL);INSERT INTO runtime_rate_limits VALUES('mail:ip:min:127.0.0.1','[${Array(5).fill(stamp).join(",")}]','2026-09-09'),('login:ip:x','[123]','2026-09-09'),('mail:invalid','bad-json','2026-09-09');CREATE TABLE runtime_login_failures(key TEXT PRIMARY KEY,count INTEGER,first_fail_at INTEGER,locked_until INTEGER,updated_at TEXT);INSERT INTO runtime_login_failures VALUES('admin',10,123,999999,'original');`;
  const f = await fixture(t, { legacy });
  assert.equal(
    (await f.call("/messages", "POST", { text: "limited" }, false)).status,
    429,
  );
  assert.equal(
    (await f.storage.all("SELECT * FROM mail_rate_limit_hits")).length,
    5,
  );
  assert.equal(
    (await f.storage.all("SELECT * FROM runtime_rate_limits")).length,
    3,
  );
  assert.deepEqual(
    await f.storage.get("SELECT * FROM runtime_login_failures"),
    {
      key: "admin",
      count: 10,
      first_fail_at: 123,
      locked_until: 999999,
      updated_at: "original",
    },
  );
  const second = createWindChimeSqlite({ filename: f.filename });
  await second.ready;
  assert.equal(
    (await second.all("SELECT * FROM mail_rate_limit_hits")).length,
    5,
  );
  await second.close();
});

test("eight independent connections can initialize the same brand new schema concurrently without duplicate default or migration", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "windchime-init-")),
    filename = join(dir, "test.sqlite");
  const connections = Array.from({ length: 8 }, () =>
    createWindChimeSqlite({ filename }),
  );
  t.after(async () => {
    await Promise.all(connections.map((storage) => storage.close()));
    await rm(dir, { recursive: true, force: true });
  });
  await Promise.all(connections.map((storage) => storage.ready));
  assert.equal(
    (await connections[0].all("SELECT id FROM mail_topics")).length,
    1,
  );
  assert.equal(
    (await connections[7].all("SELECT id FROM windchime_migrations")).length,
    1,
  );
});

test("explicit public topic view remains public for logged-in admins; explicit admin view requires authorization", async (t) => {
  const f = await fixture(t);
  await f.service.createTopic({
    slug: "visible",
    title: "Visible",
    note: "NOTE_TO_HIDE",
  });
  for (const path of ["/topics?view=public", "/topics/visible?view=public"]) {
    const response = await f.call(path);
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes("NOTE_TO_HIDE"));
  }
  for (const path of ["/topics?view=admin", "/topics/visible?view=admin"]) {
    assert.equal((await f.call(path, "GET", undefined, false)).status, 401);
    const response = await f.call(path);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes("NOTE_TO_HIDE"));
  }
  assert.equal((await f.call("/topics?view=invalid")).status, 400);
});

test("legacy JSON password authenticates before credential stripping; header/body candidate behavior and public validation stay intact", async (t) => {
  const f = await fixture(t);
  const handlers = createWindChimeRouteHandlers({
    service: f.service,
    authorizeAdmin: async (req) => {
      const value = await req
        .clone()
        .json()
        .catch(() => ({}));
      return req.headers.get("x-mail-password") === "correct" ||
        value.password === "correct"
        ? null
        : Response.json({ error: "denied" }, { status: 401 });
    },
  });
  const call = (path, method, payload, header) =>
    handlers[method](
      new Request("http://test/api/mail" + path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(header ? { "x-mail-password": header } : {}),
        },
        body: JSON.stringify(payload),
      }),
    );
  await f.service.submitMessage(
    { text: "existing" },
    f.request("/messages", "POST", undefined, false),
  );
  const message = (await f.service.listMessages()).items[0];
  assert.equal(
    (await call("/settings", "PUT", { password: "correct", enabled: false }))
      .status,
    200,
  );
  assert.equal(
    (
      await call("/blocked-terms", "PUT", {
        password: "correct",
        terms: ["review"],
      })
    ).status,
    200,
  );
  const created = await call("/topics", "POST", {
    password: "correct",
    slug: "legacy-auth",
    title: "Legacy",
  });
  assert.equal(created.status, 201);
  assert.equal(
    (
      await call("/topics/legacy-auth", "PATCH", {
        password: "correct",
        title: "Renamed",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(`/messages/${message.id}`, "PATCH", {
        password: "correct",
        isFavorited: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("/messages/batch", "POST", {
        password: "correct",
        action: "markRead",
        ids: [message.id],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/settings",
        "PUT",
        { password: "wrong", enabled: true },
        "correct",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/settings",
        "PUT",
        { password: "correct", enabled: false },
        "wrong",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/settings",
        "PUT",
        { password: "wrong", enabled: true },
        "wrong",
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call("/settings", "PUT", {
        password: "correct",
        enabled: true,
        unexpected: true,
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("/messages", "POST", { password: "correct", text: "public" }))
      .status,
    400,
  );
});

test("explicitly empty legacy salt preserves stored sender identity while missing salt is rejected", async (t) => {
  const f = await fixture(t, { hashSalt: "" });
  const req = f.request("/messages", "POST", undefined, false);
  await f.service.submitMessage(
    { text: "legacy empty salt", senderFingerprint: " fp " },
    req,
  );
  const message = (await f.service.listMessages()).items[0];
  const expected = createHash("sha256")
    .update("127.0.0.1\ntest-agent\nfp\n")
    .digest("hex");
  assert.equal(message.senderHash, expected);
  assert.equal(
    message.senderLabel,
    `User-${expected.slice(0, 4).toUpperCase()}`,
  );
  assert.deepEqual(computeWindChimeSenderIdentity(req, " fp ", ""), {
    hash: expected,
    label: `User-${expected.slice(0, 4).toUpperCase()}`,
  });
  assert.throws(
    () => createWindChimeService({ storage: f.storage }),
    /explicit stable hashSalt/,
  );
  assert.throws(
    () => createWindChimeService({ storage: f.storage, hashSalt: 0 }),
    /explicit stable hashSalt/,
  );
});

test("blocklist preserves normal previews but never reveals new, legacy or untraceable flagged originals", async (t) => {
  const f = await fixture(t);
  await f.service.setBlockedTerms(["secret"]);
  await f.service.submitMessage(
    { text: "secret original", senderFingerprint: "flagged" },
    f.request("/messages", "POST", undefined, false),
  );
  await f.service.submitMessage(
    { text: "ordinary original", senderFingerprint: "normal" },
    f.request("/messages", "POST", undefined, false),
  );
  const flagged = (await f.service.listMessages({ filter: "flagged" }))
    .items[0];
  const normal = (await f.service.listMessages()).items[0];
  await f.service.blockSender(flagged.id);
  await f.service.blockSender(normal.id);
  assert.equal(
    (
      await f.storage.get(
        "SELECT sample_text FROM mail_blocklist WHERE hash=?",
        [flagged.senderHash],
      )
    ).sample_text,
    null,
  );
  let items = await f.service.listBlockedSenders();
  assert.equal(
    items.find((item) => item.hash === flagged.senderHash).sampleText,
    null,
  );
  assert.equal(
    items.find((item) => item.hash === normal.senderHash).sampleText,
    "ordinary original",
  );
  // Simulate an old version's stored raw excerpt and a preview whose original
  // has already been purged. Neither is a safe source for automatic rendering.
  await f.storage.run("UPDATE mail_blocklist SET sample_text=? WHERE hash=?", [
    "secret original",
    flagged.senderHash,
  ]);
  await f.storage.run(
    "INSERT INTO mail_blocklist(hash,blocked_at,sample_text) VALUES(?,?,?)",
    ["orphan", "2020-01-01", "secret orphan"],
  );
  const response = await f.call("/blocklist");
  assert.equal(response.status, 200);
  const serialized = await response.text();
  assert.ok(!serialized.includes("secret original"));
  assert.ok(!serialized.includes("secret orphan"));
  assert.ok(serialized.includes("ordinary original"));
  await f.storage.run("DELETE FROM mail_messages WHERE sender_hash=?", [
    normal.senderHash,
  ]);
  items = await f.service.listBlockedSenders();
  assert.equal(
    items.find((item) => item.hash === normal.senderHash).sampleText,
    null,
  );
});
