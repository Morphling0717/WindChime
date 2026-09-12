import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { encodeWindChimeConnectionKey, parseWindChimeConnectionKey } from "../dist/core/index.js";
import { createWindChimeSqlite } from "../dist/sqlite/index.js";
import { createWindChimeService } from "../dist/server/index.js";
import { createWindChimeLiveRouteHandlers } from "../dist/next/index.js";

const token = "wc_ctl_" + "A".repeat(43);
const example = { origin: "https://site.test", siteId: "site-风铃", token };
const rawKey = value => "wc_conn_v1." + Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
function invalid(operation) {
  assert.throws(operation, error => error.code === "CONNECTION_KEY_INVALID" && error.status === 400 && !error.message.includes(token) && !error.message.includes("SECRET_INPUT"));
}

test("connection key codec round-trips UTF-8 without Node Buffer and normalizes origins", () => {
  const previous = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    const key = encodeWindChimeConnectionKey({ ...example, v: 1, origin: "HTTPS://SITE.TEST:443/" });
    assert.ok(key.startsWith("wc_conn_v1."));
    assert.deepEqual(parseWindChimeConnectionKey(" \n" + key + "\t"), { v: 1, ...example });
    assert.equal(encodeWindChimeConnectionKey(parseWindChimeConnectionKey(key)), key);
  } finally { globalThis.Buffer = previous; }
});

test("connection origins permit HTTPS and explicit loopback HTTP, without paths or credentials", () => {
  for (const origin of ["https://example.test:8443", "http://localhost:3021", "http://127.0.0.1:3022", "http://[::1]:3000"]) {
    assert.equal(parseWindChimeConnectionKey(encodeWindChimeConnectionKey({ ...example, origin })).origin, origin);
  }
  for (const origin of ["http://example.test", "http://127.1", "http://2130706433", "http://localhost.evil.test", "ftp://site.test", "file:///tmp", "https://user:SECRET_INPUT@site.test", "https://site.test/path", "https://site.test/?secret=SECRET_INPUT", "https://site.test/#SECRET_INPUT", "https://site.test/?", "https://site.test/#", "https://site.test\\evil", "https://site.test\n", " https://site.test", "https://site.test:99999"]) {
    invalid(() => encodeWindChimeConnectionKey({ ...example, origin }));
    invalid(() => parseWindChimeConnectionKey(rawKey({ v: 1, ...example, origin })));
  }
});

test("connection keys reject display credentials, unknown fields and invalid identifiers", () => {
  for (const extra of [{ v: 2 }, { topicId: "other" }, { grantId: "other" }, { token: "wc_disp_" + "A".repeat(43) }, { token: token + "A" }, { token: token.slice(0, -1) }, { token: "wc_ctl_" + "?".repeat(43) }, { siteId: "" }, { siteId: " " }, { siteId: "a".repeat(201) }, { siteId: "SECRET_INPUT\n" }]) {
    invalid(() => encodeWindChimeConnectionKey({ ...example, ...extra }));
    invalid(() => parseWindChimeConnectionKey(rawKey({ v: 1, ...example, ...extra })));
  }
  for (const value of [null, true, [], {}, { ...example }, { v: 1, origin: example.origin, siteId: example.siteId }]) invalid(() => parseWindChimeConnectionKey(rawKey(value)));
  invalid(() => parseWindChimeConnectionKey(rawKey('{"v":1,"origin":"https://site.test","siteId":"site","token":"' + token + '","__proto__":{}}')));
  assert.equal(parseWindChimeConnectionKey(encodeWindChimeConnectionKey({ ...example, siteId: "界".repeat(200) })).siteId.length, 200);
});

test("connection key parser bounds input and rejects malformed base64, JSON and UTF-8 with safe errors", () => {
  const key = encodeWindChimeConnectionKey(example);
  for (const value of [null, {}, 42, "", token, key.replace("v1", "v2"), key + "=", key + ".", "wc_conn_v1.A", rawKey("SECRET_INPUT{"), "wc_conn_v1." + Buffer.from([0xc3, 0x28]).toString("base64url"), " ".repeat(4096) + key]) invalid(() => parseWindChimeConnectionKey(value));
  invalid(() => encodeWindChimeConnectionKey({ ...example, origin: "https://" + "a".repeat(2049) }));
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "windchime-connection-"));
  const storage = createWindChimeSqlite({ filename: join(directory, "mail.db") });
  let now = Date.parse("2026-09-13T00:00:00Z"), adminCalls = 0;
  const service = createWindChimeService({ storage, hashSalt: "connection-test", now: () => now, runtimeEpoch: randomUUID() });
  await service.ready();
  const handlers = createWindChimeLiveRouteHandlers({ service, now: () => now, authorizeAdmin(req) { adminCalls++; return req.headers.get("x-test-admin") === "yes" ? null : false; } });
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }); });
  const call = (path, authority, method = "GET", body, headers = {}) => handlers[method](new Request("https://site.test/api/mail/live/" + path, {
    method, headers: { ...(authority === "admin" ? { "x-test-admin": "yes", cookie: "admin=present" } : authority ? { authorization: "Bearer " + authority } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  async function action(action, messageId) {
    const state = await service.broadcast.state("default");
    return service.broadcast.action({ topicId: "default", action, messageId, operationId: randomUUID(), expectedRevision: state.revision, expectedDraftRevision: state.messages.find(m => m.id === messageId)?.draftRevision });
  }
  async function child(parent) {
    const response = await call("control/grants", parent.token, "POST", { topicId: parent.topicId, kind: "display", label: "test output" });
    assert.equal(response.status, 201);
    const grant = await response.json(), opened = await (await call("display/open", grant.token, "POST", {})).json();
    return { ...grant, ...opened };
  }
  return { service, storage, call, action, child, now: () => now, advance: ms => now += ms, adminCalls: () => adminCalls };
}

test("capabilities advertise reusable connection keys without changing protocol version", async t => {
  const f = await fixture(t), response = await f.call("capabilities"), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.protocolVersion, 1); assert.equal(data.features.connectionKeys, true);
  assert.equal(data.features.pairing, true); assert.equal(data.siteId, await f.service.broadcast.siteId());
});

test("control identity returns only server-derived grant metadata, including non-default topics", async t => {
  const f = await fixture(t), topic = await f.service.createTopic({ slug: "private-event", title: "只属于此授权的信箱", note: "SECRET_INPUT_ADMIN_NOTE" });
  await f.service.submitMessage({ text: "SECRET_INPUT_UNREVIEWED_BODY", nickname: "SECRET_INPUT_NICK", topicSlug: topic.slug }, new Request("https://site.test/"));
  const grant = await f.service.broadcast.createGrant(topic.id, "control", "主播桌面");
  const expected = { siteId: await f.service.broadcast.siteId(), topicId: topic.id, topicTitle: topic.title, label: "主播桌面", expiresAt: grant.expiresAt, grantId: grant.id };
  const response = await f.call("control/identity", grant.token), data = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(data, expected);
  assert.deepEqual(await f.service.broadcast.controlIdentity(grant.token), expected);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(!JSON.stringify(data).includes("SECRET_INPUT")); assert.ok(!JSON.stringify(data).includes(grant.token));
  assert.equal(f.adminCalls(), 0);
});

test("identity refuses cookie authority, display tokens, malformed tokens, query scope and mutations", async t => {
  const f = await fixture(t), control = await f.service.broadcast.createGrant("default", "control"), display = await f.service.broadcast.createGrant("default", "display");
  for (const authority of [undefined, "admin", display.token, token, "not-a-token"]) {
    const response = await f.call("control/identity", authority);
    assert.equal(response.status, 401); assert.equal((await response.json()).code, "CONNECTION_KEY_INVALID");
  }
  const confused = await f.call("control/identity", display.token, "GET", undefined, { "x-test-admin": "yes", cookie: "admin=present" });
  assert.equal(confused.status, 401); assert.equal(f.adminCalls(), 0, "identity never falls back to admin cookies");
  for (const query of ["?topicId=default", "?topicId=other", "?topicId=default&topicId=other", "?token=SECRET_INPUT", "?grantId=other"]) {
    const response = await f.call("control/identity" + query, control.token); assert.equal(response.status, 400); assert.equal((await response.json()).code, "INVALID_QUERY");
  }
  assert.equal((await f.call("control/identity", control.token, "POST", {})).status, 405);
  assert.equal((await f.call("control/identity", control.token, "DELETE")).status, 405);
});

test("the same pasted connection key remains reusable without issuing more grants or changing broadcast state", async t => {
  const f = await fixture(t), issued = await f.call("control/grants", "admin", "POST", { topicId: "default", kind: "control", label: "共用连接" });
  assert.equal(issued.status, 201);
  const grant = await issued.json(), siteId = await f.service.broadcast.siteId();
  assert.equal(Date.parse(grant.expiresAt) - f.now(), 30 * 86400000);
  const key = encodeWindChimeConnectionKey({ origin: "https://site.test", siteId, token: grant.token });
  const before = await f.service.broadcast.state("default");
  const results = await Promise.all(Array.from({ length: 4 }, async () => {
    const imported = parseWindChimeConnectionKey(key), response = await f.call("control/identity", imported.token);
    assert.equal(response.status, 200); return response.json();
  }));
  assert.ok(results.every(result => result.grantId === grant.id));
  assert.equal((await f.service.broadcast.listGrants("default")).length, 1);
  assert.deepEqual(await f.service.broadcast.state("default"), before);
});

test("identity distinguishes unknown, expired and revoked keys without weakening existing authorization", async t => {
  const f = await fixture(t), expiring = await f.service.broadcast.createGrant("default", "control", "expires", 1000), revoked = await f.service.broadcast.createGrant("default", "control", "revoked", 1000);
  await f.service.broadcast.revokeGrant(revoked.id, "default"); f.advance(1000);
  for (const [value, code] of [[token, "CONNECTION_KEY_INVALID"], [expiring.token, "CONNECTION_KEY_EXPIRED"], [revoked.token, "CONNECTION_KEY_REVOKED"]]) {
    const response = await f.call("control/identity", value); assert.equal(response.status, 401); assert.equal((await response.json()).code, code);
    await assert.rejects(f.service.broadcast.controlIdentity(value), error => error.code === code);
    assert.equal((await f.call("control/state", value)).status, 401);
  }
});

test("revoking a shared key stops every derived display while another key and its display remain usable", async t => {
  const f = await fixture(t);
  await f.service.submitMessage({ text: "reviewed for revoke test" }, new Request("https://site.test/"));
  const message = (await f.service.broadcast.state("default")).messages[0];
  const first = await f.service.broadcast.createGrant("default", "control", "shared"), second = await f.service.broadcast.createGrant("default", "control", "independent");
  const outputs = [await f.child(first), await f.child(first)], other = await f.child(second);
  await f.action("approve", message.id); await f.action("show", message.id);
  for (const output of [...outputs, other]) assert.equal((await (await f.call("display/frame?receiverId=" + output.receiverId, output.token)).json()).snapshot.messageId, message.id);
  const revoked = await f.call("control/grants/" + first.id + "?topicId=default", "admin", "DELETE"); assert.equal(revoked.status, 200);
  assert.equal((await (await f.call("control/identity", first.token)).json()).code, "CONNECTION_KEY_REVOKED");
  for (const output of outputs) assert.equal((await f.call("display/frame?receiverId=" + output.receiverId, output.token)).status, 401);
  assert.equal((await f.call("control/identity", second.token)).status, 200);
  assert.equal((await (await f.call("display/frame?receiverId=" + other.receiverId, other.token)).json()).snapshot.messageId, message.id);
});

test("parent key expiry stops a longer-lived child display and identity, without expiring another key", async t => {
  const f = await fixture(t), first = await f.service.broadcast.createGrant("default", "control", "short", 1000), second = await f.service.broadcast.createGrant("default", "control", "long", 10000), output = await f.child(first);
  assert.ok(Date.parse(output.expiresAt) > Date.parse(first.expiresAt)); f.advance(1000);
  assert.equal((await (await f.call("control/identity", first.token)).json()).code, "CONNECTION_KEY_EXPIRED");
  assert.equal((await f.call("display/frame?receiverId=" + output.receiverId, output.token)).status, 401);
  assert.equal((await f.call("control/identity", second.token)).status, 200);
});

test("a connection key cannot cross websites or topics or create further control credentials", async t => {
  const f = await fixture(t), other = await fixture(t), topic = await f.service.createTopic({ slug: "other", title: "Other" }), control = await f.service.broadcast.createGrant("default", "control");
  assert.notEqual(await f.service.broadcast.siteId(), await other.service.broadcast.siteId());
  assert.equal((await other.call("control/identity", control.token)).status, 401);
  assert.equal((await f.call("control/state?topicId=" + topic.id, control.token)).status, 403);
  assert.equal((await f.call("control/grants", control.token, "POST", { topicId: "default", kind: "control" })).status, 403);
  assert.equal((await f.call("control/grants", control.token, "POST", { topicId: topic.id, kind: "display" })).status, 403);
  const unrelated = await f.service.broadcast.createGrant(topic.id, "control");
  assert.equal((await f.call("control/grants/" + unrelated.id + "?topicId=default", control.token, "DELETE")).status, 404);
  assert.equal((await f.call("control/identity", unrelated.token)).status, 200);
});
