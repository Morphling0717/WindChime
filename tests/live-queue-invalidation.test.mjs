import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createWindChimeSqlite } from "../dist/sqlite/index.js";
import { initializeWindChimeLiveSchema } from "../dist/sqlite/live-schema.js";
import { createWindChimeService } from "../dist/server/index.js";

async function fixture(t) {
  const storage = createWindChimeSqlite({ filename: ":memory:" });
  const service = createWindChimeService({ storage, hashSalt: "queue-regression", now: () => 1789862400000, runtimeEpoch: "queue-test" });
  await service.ready();
  t.after(() => storage.close());
  let serial = 0;
  async function submit(text) {
    await service.submitMessage({ text }, new Request("https://queue.test", { headers: { "x-real-ip": "10.0.0." + (++serial) } }));
    return (await service.listMessages()).items.find(message => message.text === text).id;
  }
  async function act(action, messageId, extra = {}) {
    const state = await service.broadcast.state("default");
    return service.broadcast.action({ topicId: "default", action, messageId, expectedRevision: state.revision,
      expectedDraftRevision: state.messages.find(message => message.id === messageId)?.draftRevision, operationId: randomUUID(), ...extra });
  }
  const issued = await service.broadcast.createGrant("default", "display");
  const grant = await service.broadcast.authenticate(issued.token, "display");
  const receiver = await service.broadcast.open(grant);
  async function assets(messageId) {
    const ids = [randomUUID(), randomUUID()];
    for (const [ordinal, id] of ids.entries()) await storage.run(`INSERT INTO mail_live_assets
      (id,topic_id,message_id,ordinal,sha256,mime_type,width,height,size,created_at,expires_at)
      VALUES(?,'default',?,?,?,'image/webp',10,10,20,0,9999999999999)`, [id, messageId, ordinal, "a".repeat(64)]);
    return ids;
  }
  return { storage, service, submit, act, assets, frame: () => service.broadcast.frame(grant, receiver.receiverId) };
}

test("unrelated mailbox deletion, blocking and source edits keep the approved current snapshot", async t => {
  for (const mode of ["delete", "batch", "block", "hard-delete", "text", "nickname", "link", "flag"]) await t.test(mode, async t => {
    const f = await fixture(t), a = await f.submit("playing"), b = await f.submit("unrelated");
    await f.act("approve", a); await f.act("approve", b); await f.act("show", a);
    const before = await f.frame(), state = await f.service.broadcast.state("default");
    if (mode === "delete") await f.service.deleteMessage(b);
    if (mode === "batch") await f.service.batchMessages({ action: "delete", ids: [b] });
    if (mode === "block") await f.service.blockSender(b);
    if (mode === "hard-delete") await f.storage.run("DELETE FROM mail_messages WHERE id=?", [b]);
    if (mode === "text") await f.storage.run("UPDATE mail_messages SET text='edited' WHERE id=?", [b]);
    if (mode === "nickname") await f.storage.run("UPDATE mail_messages SET nickname='edited' WHERE id=?", [b]);
    if (mode === "link") await f.storage.run("UPDATE mail_messages SET link_url='https://example.test' WHERE id=?", [b]);
    if (mode === "flag") await f.service.updateMessage(b, { isFlagged: true });
    const changed = await f.service.broadcast.state("default"), after = await f.frame();
    assert.deepEqual(after.snapshot, before.snapshot);
    assert.equal(after.activation, before.activation, "an unrelated edit must not activate or clear any receiver");
    assert(changed.revision > state.revision, "old control requests still need invalidation");
    assert.deepEqual(changed.queue, [a]);
    await assert.rejects(f.act("show", a, { expectedRevision: state.revision }), error => error.code === "REVISION_CONFLICT");
  });
});

test("source-image order changes withdraw only their own approval and current output", async t => {
  const f = await fixture(t), a = await f.submit("playing"), b = await f.submit("images");
  const assets = await f.assets(b);
  await f.act("approve", a); await f.act("approve", b); await f.act("show", a);
  const before = await f.frame();
  await f.storage.run("UPDATE mail_live_assets SET ordinal=2 WHERE id=?", [assets[0]]);
  const changed = await f.service.broadcast.state("default"), after = await f.frame();
  assert.deepEqual(after.snapshot, before.snapshot); assert.equal(after.activation, before.activation);
  assert.equal(changed.messages.find(message => message.id === b).status, "pending");
  assert.deepEqual(changed.queue, [a]);
  await f.act("approve", b); await f.act("show", b);
  await f.storage.run("UPDATE mail_live_assets SET ordinal=3 WHERE id=?", [assets[1]]);
  assert.equal((await f.frame()).snapshot, null, "source hashing must hide changed current content even before a control poll");
  assert.deepEqual((await f.service.broadcast.state("default")).queue, [a]);
  assert.equal((await f.frame()).snapshot, null);
});

test("removing the first, middle or last shown item advances to its successor without wrapping", async t => {
  for (const mode of ["revoke", "reject", "draft", "delete", "batch", "hard-delete", "source-text", "source-images"]) {
    for (const index of [0, 1, 2]) await t.test(mode + " at " + index, async t => {
      const f = await fixture(t), ids = [await f.submit("A"), await f.submit("B"), await f.submit("C")];
      const assets = mode === "source-images" ? await f.assets(ids[index]) : [];
      for (const id of ids) await f.act("approve", id);
      await f.act("show", ids[index]);
      if (mode === "revoke" || mode === "reject") await f.act(mode, ids[index]);
      if (mode === "draft") {
        const draft = (await f.service.broadcast.state("default")).messages.find(message => message.id === ids[index]).draft;
        await f.act("draft", ids[index], { draft: { ...draft, text: "edited" } });
      }
      if (mode === "delete") await f.service.deleteMessage(ids[index]);
      if (mode === "batch") await f.service.batchMessages({ action: "delete", ids: [ids[index]] });
      if (mode === "hard-delete") await f.storage.run("DELETE FROM mail_messages WHERE id=?", [ids[index]]);
      if (mode === "source-text") await f.storage.run("UPDATE mail_messages SET text='edited' WHERE id=?", [ids[index]]);
      if (mode === "source-images") await f.storage.run("UPDATE mail_live_assets SET ordinal=2 WHERE id=?", [assets[0]]);
      await f.service.broadcast.state("default");
      assert.equal((await f.frame()).snapshot, null);
      await f.act("next");
      assert.equal((await f.frame()).snapshot?.messageId ?? null, ids[index + 1] ?? null);
      if (index === 2) {
        await f.act("next"); assert.equal((await f.frame()).snapshot, null, "repeated next at the end remains blank");
      }
    });
  }
});

test("batch and successive removals retain the successor across either deletion order", async t => {
  for (const mode of ["batch", "forward", "reverse"]) for (const currentIndex of [2, 3]) await t.test(mode + " at " + currentIndex, async t => {
    const f = await fixture(t), ids = [];
    for (const text of ["A", "B", "C", "D"]) { const id = await f.submit(text); ids.push(id); await f.act("approve", id); }
    await f.act("show", ids[currentIndex]);
    const removed = ids.slice(1, currentIndex + 1);
    if (mode === "batch") await f.service.batchMessages({ action: "delete", ids: removed });
    else for (const id of mode === "forward" ? removed : removed.toReversed()) await f.service.deleteMessage(id);
    await f.act("next");
    assert.equal((await f.frame()).snapshot?.messageId ?? null, ids[currentIndex + 1] ?? null);
  });
});

test("queue cursor uses reordered positions and reapproval appends without starting playback", async t => {
  const f = await fixture(t), a = await f.submit("A"), b = await f.submit("B"), c = await f.submit("C");
  for (const id of [a, b, c]) await f.act("approve", id);
  await f.act("reorder", undefined, { order: [c, a, b] }); await f.act("show", a); await f.act("revoke", a);
  await f.act("next"); assert.equal((await f.frame()).snapshot.messageId, b);
  await f.act("approve", a); assert.equal((await f.frame()).snapshot.messageId, b);
  assert.deepEqual((await f.service.broadcast.state("default")).queue, [c, b, a]);
  await f.act("next"); assert.equal((await f.frame()).snapshot.messageId, a);
  await f.act("revoke", a); await f.act("next"); assert.equal((await f.frame()).snapshot, null);
  await f.act("end"); await f.act("next"); assert.equal((await f.frame()).snapshot.messageId, c);
});

test("legacy missing cursor stays blank until an explicit show or end resets progress", async t => {
  const f = await fixture(t), a = await f.submit("A"), b = await f.submit("B");
  await f.act("approve", a); await f.act("approve", b); await f.act("show", b);
  await f.storage.run("UPDATE mail_live_channels SET last_shown='legacy-removed-id' WHERE topic_id='default'");
  await f.act("next"); assert.equal((await f.frame()).snapshot, null);
  await f.act("next"); assert.equal((await f.frame()).snapshot, null);
  await f.act("show", a); await f.act("next"); assert.equal((await f.frame()).snapshot.messageId, b);
});

test("a failed queue removal rolls back its cursor, approval and displayed snapshot together", async t => {
  const f = await fixture(t), a = await f.submit("A"), b = await f.submit("B"), c = await f.submit("C");
  for (const id of [a, b, c]) await f.act("approve", id);
  await f.act("show", b);
  const before = await f.service.broadcast.state("default"), channel = await f.storage.get("SELECT * FROM mail_live_channels WHERE topic_id='default'");
  await f.storage.run("CREATE TRIGGER test_queue_removal_failure AFTER DELETE ON mail_live_queue BEGIN SELECT RAISE(ABORT,'injected queue failure'); END");
  await assert.rejects(f.act("revoke", b), /injected queue failure/);
  assert.deepEqual(await f.service.broadcast.state("default"), before);
  assert.deepEqual(await f.storage.get("SELECT * FROM mail_live_channels WHERE topic_id='default'"), channel);
  assert.equal((await f.frame()).snapshot.messageId, b);
  await f.storage.run("DROP TRIGGER test_queue_removal_failure");
  await f.act("next"); assert.equal((await f.frame()).snapshot.messageId, c);
});

test("trigger migration replaces both legacy invalidations twice without rewriting mailbox or authority data", async t => {
  const f = await fixture(t), a = await f.submit("A"), b = await f.submit("B"), c = await f.submit("C");
  for (const id of [a, b, c]) await f.act("approve", id);
  await f.act("show", a); await f.service.updateMessage(b, { isRead: true, isFavorited: true });
  const parent = await f.service.broadcast.createGrant(null, "control", "site", undefined, null, null, null, "site");
  await f.service.broadcast.createGrant("default", "display", "child", undefined, null, null, parent.id);
  await f.storage.run("DELETE FROM windchime_migrations WHERE id='0.8.2-live-queue-invalidation'");
  await f.storage.run("DROP TRIGGER live_queue_cursor_removed");
  for (const [name, event] of [["live_message_changed", "UPDATE"], ["live_message_deleted", "DELETE"]]) {
    await f.storage.run("DROP TRIGGER " + name);
    await f.storage.run(`CREATE TRIGGER ${name} AFTER ${event} ON mail_messages BEGIN
      UPDATE mail_live_channels SET revision=revision+1,activation=activation+1,current_snapshot=NULL WHERE topic_id=OLD.topic_id;
      DELETE FROM mail_live_queue WHERE message_id=OLD.id;
      UPDATE mail_live_drafts SET status='pending',snapshot_id=NULL,revision=revision+1 WHERE message_id=OLD.id;
      END`);
  }
  const tables = ["mail_messages", "mail_topics", "mail_live_grants", "mail_live_channels", "mail_live_drafts", "mail_live_snapshots", "mail_live_queue"];
  const before = await Promise.all(tables.map(table => f.storage.all("SELECT * FROM " + table + " ORDER BY rowid")));
  for (let pass = 0; pass < 2; pass++) {
    await f.storage.transaction(initializeWindChimeLiveSchema);
    assert.deepEqual(await Promise.all(tables.map(table => f.storage.all("SELECT * FROM " + table + " ORDER BY rowid"))), before);
  }
  assert.equal((await f.storage.get("SELECT COUNT(*) n FROM windchime_migrations WHERE id='0.8.2-live-queue-invalidation'")).n, 1);
  await f.service.deleteMessage(b); assert.equal((await f.frame()).snapshot.messageId, a);
  await f.storage.run("DELETE FROM mail_messages WHERE id=?", [c]); assert.equal((await f.frame()).snapshot.messageId, a);
  await f.act("revoke", a); assert.equal((await f.frame()).snapshot, null);
  await f.act("next"); assert.equal((await f.frame()).snapshot, null);
});
