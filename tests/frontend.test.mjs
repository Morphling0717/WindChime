import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act } from "react-test-renderer";
import {
  createWindChimeClient,
  WindChimeClientError,
  windChimeMessagesToCsv,
} from "../dist/client/index.js";
import {
  useWindChimeInbox,
  useWindChimeReview,
  useWindChimeSubmission,
} from "../dist/react/index.js";
import { readWindChimePosterConfig } from "../dist/media/index.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const counts = { all: 1, unread: 1, favorited: 0, flagged: 0 };
const row = (id) => ({
  id,
  topicId: id,
  text: id,
  createdAt: "2026-09-09T00:00:00Z",
});
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

test("headless entries import in Node without CSS, browser globals, or sqlite", async () => {
  assert.equal(
    typeof (await import("../dist/core/index.js")).validateWindChimeSubmission,
    "function",
  );
  assert.equal(
    typeof (await import("../dist/react/index.js")).useWindChimeTurnstile,
    "function",
  );
  assert.equal(
    typeof (await import("../dist/media/index.js")).renderWindChimeQr,
    "function",
  );
});

test("client keeps topic scope, auth, server errors, and atomic archive options", async () => {
  const calls = [];
  const client = createWindChimeClient({
    baseUrl: "https://example.test/custom/",
    getHeaders: async () => ({ Authorization: "test-token" }),
    fetch: async (url, init) => {
      calls.push({ url, init });
      return json({ ok: true });
    },
  });
  await client.messages.batch("markRead", ["a"], { topicId: "主题 A" });
  assert.equal(new URL(calls[0].url).searchParams.get("topicId"), "主题 A");
  assert.equal(calls[0].init.headers.get("authorization"), "test-token");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: "markRead",
    ids: ["a"],
  });
  await client.topics.archive("target", { markReadFirst: true });
  assert.equal(calls[1].url, "https://example.test/custom/topics/target");
  assert.deepEqual(JSON.parse(calls[1].init.body), { markReadFirst: true });
  let notified = false;
  const failing = createWindChimeClient({
    fetch: async () => json({ code: "TOPIC_NOT_FOUND", error: "missing" }, 404),
  });
  failing.subscribe(() => {
    notified = true;
  });
  await assert.rejects(
    failing.messages.delete("other", { topicId: "a" }),
    (error) =>
      error instanceof WindChimeClientError &&
      error.code === "TOPIC_NOT_FOUND" &&
      error.status === 404,
  );
  assert.equal(notified, false);
});

test("inbox switching scopes rejects late responses even when transport ignores abort", async () => {
  const requests = [];
  const client = createWindChimeClient({
    fetch: (url, init) => {
      const task = deferred();
      requests.push({ url, init, ...task });
      return task.promise;
    },
  });
  let inbox;
  let tree;
  function Harness({ topicId }) {
    inbox = useWindChimeInbox(client, { topicId });
    return null;
  }
  await act(async () => {
    tree = create(React.createElement(Harness, { topicId: "a" }));
  });
  await act(async () => {
    tree.update(React.createElement(Harness, { topicId: "b" }));
  });
  assert.equal(requests[0].init.signal.aborted, true);
  assert.deepEqual(inbox.items, []);
  await act(async () => {
    requests[1].resolve(json({ items: [row("b")], counts }));
  });
  assert.equal(inbox.items[0].id, "b");
  await act(async () => {
    inbox.toggleSelected("b");
  });
  assert.deepEqual([...inbox.selectedIds], ["b"]);
  await act(async () => {
    requests[0].resolve(json({ items: [row("a")], counts }));
  });
  assert.equal(inbox.items[0].id, "b");
  await act(async () => {
    tree.update(React.createElement(Harness, { topicId: "c" }));
  });
  assert.deepEqual([...inbox.selectedIds], []);
  await act(async () => {
    tree.unmount();
  });
});

test("disabled resources clear private data before a later re-enable", async () => {
  let inbox;
  let tree;
  const next = deferred();
  let reads = 0;
  const client = createWindChimeClient({
    fetch: async () =>
      ++reads === 1 ? json({ items: [row("private")], counts }) : next.promise,
  });
  function Harness({ enabled }) {
    inbox = useWindChimeInbox(client, { enabled });
    return null;
  }
  await act(async () => {
    tree = create(React.createElement(Harness, { enabled: true }));
  });
  assert.equal(inbox.items[0].id, "private");
  await act(async () => {
    tree.update(React.createElement(Harness, { enabled: false }));
  });
  assert.deepEqual(inbox.items, []);
  await act(async () => {
    tree.update(React.createElement(Harness, { enabled: true }));
  });
  assert.deepEqual(inbox.items, []);
  assert.equal(inbox.isLoading, true);
  await act(async () => {
    tree.unmount();
  });
});

test("one client mutation refreshes all mounted inbox scopes; errors retain data and mutationError", async () => {
  const reads = new Map();
  let fail = false;
  let inboxA;
  let inboxB;
  let tree;
  const client = createWindChimeClient({
    fetch: async (url, init) => {
      const parsed = new URL(url, "https://example.test");
      if (init.method === "GET") {
        const scope = parsed.searchParams.get("topicId");
        reads.set(scope, (reads.get(scope) ?? 0) + 1);
        return json({ items: [row(scope)], counts });
      }
      return fail
        ? json({ error: "failed", code: "WRITE_FAILED" }, 500)
        : json({ ok: true });
    },
  });
  function Harness() {
    inboxA = useWindChimeInbox(client, { topicId: "a" });
    inboxB = useWindChimeInbox(client, { topicId: "b" });
    return null;
  }
  await act(async () => {
    tree = create(React.createElement(Harness));
  });
  await act(async () => {
    await inboxA.markRead("a");
  });
  assert.equal(reads.get("a"), 2);
  assert.equal(reads.get("b"), 2);
  fail = true;
  await act(async () => {
    await assert.rejects(inboxB.deleteMessage("b"));
  });
  assert.equal(inboxB.items[0].id, "b");
  assert.equal(inboxB.mutationError.code, "WRITE_FAILED");
  assert.equal(inboxB.pending, false);
  assert.equal(reads.get("b"), 2);
  await act(async () => {
    tree.unmount();
  });
});

test("moderation raw detail never follows a topic switch", async () => {
  const raw = deferred();
  let review;
  let tree;
  const client = createWindChimeClient({
    fetch: async (url) =>
      url.includes("/messages/sensitive")
        ? raw.promise
        : json({ items: [], counts }),
  });
  function Harness({ topicId }) {
    review = useWindChimeReview(client, { topicId });
    return null;
  }
  await act(async () => {
    tree = create(React.createElement(Harness, { topicId: "a" }));
  });
  await act(async () => {
    review.openDetail("sensitive");
  });
  await act(async () => {
    tree.update(React.createElement(Harness, { topicId: "b" }));
  });
  await act(async () => {
    raw.resolve(json(row("sensitive")));
  });
  assert.equal(review.detail, null);
  assert.equal(review.detailLoading, false);
  await act(async () => {
    tree.update(React.createElement(Harness, { topicId: "a" }));
  });
  assert.equal(review.detail, null);
  assert.equal(review.detailLoading, false);
  await act(async () => {
    tree.unmount();
  });
});

test("submission guards double sends and retains draft on failure, without UI side effects", async () => {
  let form;
  let tree;
  let count = 0;
  const send = deferred();
  function Harness() {
    form = useWindChimeSubmission({
      onSubmit: async () => {
        ++count;
        await send.promise;
      },
      rateLimit: false,
      disableSenderFingerprint: true,
    });
    return null;
  }
  await act(async () => {
    tree = create(React.createElement(Harness));
  });
  await act(async () => {
    form.setText(" a draft ");
  });
  let first;
  let second;
  await act(async () => {
    first = form.submit();
    second = form.submit();
  });
  assert.equal(await second, false);
  assert.equal(count, 1);
  await act(async () => {
    send.reject(new WindChimeClientError("WRITE_FAILED", 503));
    assert.equal(await first, false);
  });
  assert.equal(form.text, " a draft ");
  assert.equal(form.success, false);
  assert.equal(form.error.code, "WRITE_FAILED");
  assert.equal(form.sending, false);
  await act(async () => {
    tree.unmount();
  });
});

test("CSV exports safely and storage ignores malformed configuration", () => {
  const csv = windChimeMessagesToCsv([
    {
      ...row("a"),
      nickname: '=HYPERLINK("evil")',
      text: 'line 1\nline 2,"quoted"',
    },
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('""quoted""'));
  const fallback = { heading: "ours", body: "", footer: "", avatarSrc: "" };
  assert.deepEqual(
    readWindChimePosterConfig("x", fallback, {
      getItem: () => '{"heading":42,"footer":"custom","unknown":"x"}',
    }),
    { ...fallback, footer: "custom" },
  );
});

test("public topic APIs strip private fields and endpoint overrides retain query configuration", async () => {
  let received;
  const client = createWindChimeClient({
    endpoints: { topics: "https://example.test/custom/topics?tenant=x" },
    fetch: async (url) => {
      received = new URL(url);
      return json({
        items: [
          {
            id: "a",
            title: "A",
            slug: "a",
            note: "private",
            unreadCount: 4,
            flaggedCount: 2,
            customAdminSecret: "private",
          },
        ],
      });
    },
  });
  const result = await client.topics.listPublic();
  assert.equal(received.searchParams.get("view"), "public");
  assert.equal(received.searchParams.get("tenant"), "x");
  assert.equal(received.pathname, "/custom/topics");
  assert.equal("note" in result.items[0], false);
  assert.equal("unreadCount" in result.items[0], false);
  assert.equal("customAdminSecret" in result.items[0], false);
});

test("a completed batch cannot clear another scope selection or leave pending stuck after returning", async () => {
  let inbox;
  let tree;
  const write = deferred();
  const client = createWindChimeClient({
    fetch: async (url, init) => {
      if (init.method !== "GET") return write.promise;
      const scope = new URL(url, "https://example.test").searchParams.get(
        "topicId",
      );
      return json({ items: [row(scope)], counts });
    },
  });
  function Harness({ topicId }) {
    inbox = useWindChimeInbox(client, { topicId });
    return null;
  }
  await act(async () => {
    tree = create(React.createElement(Harness, { topicId: "a" }));
  });
  await act(async () => {
    inbox.toggleSelected("a");
  });
  let pending;
  await act(async () => {
    pending = inbox.batch("markRead");
  });
  assert.equal(inbox.pending, true);
  await act(async () => {
    tree.update(React.createElement(Harness, { topicId: "b" }));
  });
  await act(async () => {
    inbox.toggleSelected("b");
  });
  await act(async () => {
    write.resolve(json({ ok: true }));
    await pending;
  });
  assert.deepEqual([...inbox.selectedIds], ["b"]);
  await act(async () => {
    tree.update(React.createElement(Harness, { topicId: "a" }));
  });
  assert.equal(inbox.pending, false);
  assert.equal(inbox.mutationError, null);
  await act(async () => {
    tree.unmount();
  });
});

test("an old submission cannot clear a new draft after leaving and returning to its topic", async () => {
  let form;
  let tree;
  const write = deferred();
  function Harness({ topicSlug }) {
    form = useWindChimeSubmission({
      topicSlug,
      onSubmit: () => write.promise,
      rateLimit: false,
      disableSenderFingerprint: true,
    });
    return null;
  }
  await act(async () => {
    tree = create(React.createElement(Harness, { topicSlug: "a" }));
  });
  await act(async () => {
    form.setText("first");
  });
  let pending;
  await act(async () => {
    pending = form.submit();
  });
  await act(async () => {
    tree.update(React.createElement(Harness, { topicSlug: "b" }));
  });
  await act(async () => {
    tree.update(React.createElement(Harness, { topicSlug: "a" }));
    form.setText("new draft");
  });
  await act(async () => {
    write.resolve();
    await pending;
  });
  assert.equal(form.text, "new draft");
  assert.equal(form.success, false);
  assert.equal(form.sending, false);
  await act(async () => {
    tree.unmount();
  });
});
