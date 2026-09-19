import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { WindChimeLiveControlPanel } from '../dist/broadcast/ControlPanel.js';
import { WindChimeLiveCard } from '../dist/broadcast/Display.js';
import { DEFAULT_WINDCHIME_LIVE_APPEARANCE as appearance } from '../dist/core/live.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const blob = (name, type = 'image/webp') => Object.assign(new Blob([name], { type }), { fixtureName: name });

async function fixture(t, { ids = ['wide', 'portrait'], asset, decode } = {}) {
  const originalDecode = globalThis.createImageBitmap, originalCreate = URL.createObjectURL, originalRelease = URL.revokeObjectURL;
  const created = [], released = [], closed = [], requested = [];
  const bitmap = (name, width = 400, height = 800) => ({ width, height, close: () => closed.push(name) });
  URL.createObjectURL = bytes => { const url = `blob:review-${created.length}`; created.push({ name: bytes.fixtureName, url }); return url; };
  URL.revokeObjectURL = url => released.push(url);
  globalThis.createImageBitmap = decode ? value => decode(value, bitmap) : async value => bitmap(value.fixtureName, value.fixtureName === 'wide' ? 1200 : 300, value.fixtureName === 'wide' ? 400 : 600);
  const draft = { nickname: 'Synthetic', text: 'Image preview fixture', linkUrl: null, assets: ids.map(id => ({ id, caption: id })) };
  const client = {
    state: async topicId => ({ topicId, revision: 1, epoch: 'fixture', appearance, receivers: 0, queue: [], current: null,
      messages: [{ id: 'letter', createdAt: '2026-09-20T00:00:00Z', isRead: false, isFavorited: false, isFlagged: false,
        source: structuredClone(draft), draft: structuredClone(draft), draftRevision: 1, status: 'pending', snapshotId: null }] }),
    asset: async (topicId, id, signal) => { requested.push({ topicId, id, signal }); return asset ? asset(topicId, id, signal) : blob(id, id === 'wide' ? 'image/jpeg' : 'image/webp'); },
  };
  let renderer;
  const render = topicId => React.createElement(WindChimeLiveControlPanel, { module: 'review', client, topicId, selectedMessageId: 'letter', canApproveDevices: false });
  const unmount = async () => { if (renderer) { await act(async () => renderer.unmount()); renderer = null; } };
  t.after(async () => {
    await unmount();
    if (originalDecode === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originalDecode;
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRelease;
  });
  await act(async () => { renderer = create(render('topic-A')); await flush(); });
  return {
    client, created, released, closed, requested, bitmap, unmount,
    get card() { return renderer.root.findByType(WindChimeLiveCard); },
    get approve() { return renderer.root.findAllByType('button').find(button => button.children.join('') === '批准进入待播'); },
    async switchTopic(topicId) { await act(async () => { renderer.update(render(topicId)); await flush(); }); },
  };
}

test('reviewed image previews use decoded dimensions and MIME types in original order', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.card.props.snapshot.assets.map(({ id, width, height, mimeType }) => ({ id, width, height, mimeType })), [
    { id: 'wide', width: 1200, height: 400, mimeType: 'image/jpeg' },
    { id: 'portrait', width: 300, height: 600, mimeType: 'image/webp' },
  ]);
  assert.deepEqual(f.card.findAllByType('img').map(img => img.props.style['--wc-display-image-ratio']), [3, 0.5]);
  assert.equal(f.approve.props.disabled, false);
  assert.deepEqual(f.closed.sort(), ['portrait', 'wide']);
  assert.equal(f.released.length, 0);
  await f.unmount();
  assert.deepEqual(f.released.sort(), f.created.map(item => item.url).sort(), 'every published URL is released exactly once');
});

test('switching topic during decode closes the abandoned bitmap without publishing its URL', async t => {
  const oldDecode = deferred();
  const f = await fixture(t, { ids: ['same-id'], asset: async topic => blob(topic),
    decode: (bytes, bitmap) => bytes.fixtureName === 'topic-A' ? oldDecode.promise : Promise.resolve(bitmap('topic-B', 960, 540)) });
  assert.equal(f.card.props.snapshot.assets.length, 0);
  assert.equal(f.approve.props.disabled, true, 'approval waits for an actually decoded preview');
  await f.switchTopic('topic-B');
  const currentUrl = f.card.props.assetUrls['same-id'];
  assert.deepEqual(f.created.map(item => item.name), ['topic-B']);
  assert.equal(f.requested[0].signal.aborted, true);
  await act(async () => { oldDecode.resolve(f.bitmap('topic-A', 20, 100)); await flush(); });
  assert.equal(f.card.props.assetUrls['same-id'], currentUrl);
  assert.equal(f.card.props.snapshot.assets[0].width, 960);
  assert.deepEqual(f.created.map(item => item.name), ['topic-B']);
  assert(f.closed.includes('topic-A'));
  assert(!f.released.includes(currentUrl));
});

test('a late download after unmount is not decoded and cannot create an object URL', async t => {
  const pending = deferred(); let decodes = 0;
  const f = await fixture(t, { ids: ['late'], asset: () => pending.promise,
    decode: async (_bytes, bitmap) => { decodes++; return bitmap('late'); } });
  await f.unmount();
  await act(async () => { pending.resolve(blob('late')); await flush(); });
  assert.equal(f.requested[0].signal.aborted, true);
  assert.equal(decodes, 0); assert.equal(f.created.length, 0); assert.equal(f.released.length, 0);
});

test('a failed batch promptly releases completed URLs and closes decodes that finish after failure', async t => {
  const failure = deferred(), late = deferred();
  const f = await fixture(t, { ids: ['ready', 'failed', 'late'],
    decode: (bytes, bitmap) => bytes.fixtureName === 'failed' ? failure.promise : bytes.fixtureName === 'late' ? late.promise : Promise.resolve(bitmap('ready')) });
  assert.equal(f.created.length, 1); assert.equal(f.released.length, 0);
  await act(async () => { failure.reject(new Error('synthetic decode failure')); await flush(); });
  assert.deepEqual(f.released, [f.created[0].url]);
  assert(f.requested.every(request => request.signal.aborted));
  assert.equal(f.card.props.snapshot.assets.length, 0); assert.equal(f.approve.props.disabled, true);
  await act(async () => { late.resolve(f.bitmap('late')); await flush(); });
  assert.equal(f.created.length, 1); assert(f.closed.includes('late'));
  await f.unmount(); assert.equal(f.released.length, 1, 'cleanup does not revoke an owned URL twice');
});

test('invalid decoded dimensions never produce zero-sized or NaN preview images', async t => {
  const f = await fixture(t, { ids: ['broken'], decode: async (_bytes, bitmap) => bitmap('broken', 0, 0) });
  assert.equal(f.card.props.snapshot.assets.length, 0); assert.equal(f.approve.props.disabled, true);
  assert.deepEqual(f.closed, ['broken']); assert.equal(f.created.length, 0);
});
