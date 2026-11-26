const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { createOverlayStore, isValidImageBuffer } = require('../main/overlay-store.cjs');
const { createSessionHistoryStore, formatMarkdown, formatCsv } = require('../main/session-history.cjs');

test('overlay store validates image magic bytes, clamps config bounds, and serves PNG bytes', async () => {
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  assert.equal(isValidImageBuffer(pngHeader), true);
  assert.equal(isValidImageBuffer(Buffer.from('not an image at all')), false);

  const files = new Map();
  let savedConfig = null;
  const store = createOverlayStore({
    fs: {
      mkdir: async () => {},
      readFile: async p => { if (!files.has(p)) throw Object.assign(new Error(), { code: 'ENOENT' }); return files.get(p); },
      writeFile: async (p, b) => { files.set(p, b); },
      unlink: async p => { files.delete(p); },
    },
    path,
    nativeImage: {
      createFromBuffer: bytes => ({
        isEmpty: () => false,
        getSize: () => ({ width: 512, height: 512 }),
        resize: () => ({ toPNG: () => bytes }),
      }),
    },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    getDir: () => '/virtual/overlay',
    getConfig: () => savedConfig,
    saveConfig: async c => { savedConfig = c; },
  });

  const updated = await store.update({ enabled: true, badgeSize: 999, badgeOpacity: 5, watermarkText: '  @测试台\n  ', backgroundOpacity: 99 });
  assert.equal(updated.enabled, true);
  assert.equal(updated.badgeSize, 128);
  assert.equal(updated.badgeOpacity, 10);
  assert.equal(updated.watermarkText, '@测试台');
  assert.equal(updated.backgroundOpacity, 80);

  await assert.rejects(() => store.saveImageBytes('badge', Buffer.from('bad bytes')));
  const withImg = await store.saveImageBytes('badge', pngHeader);
  assert.equal(withImg.hasBadge, true);
  assert(withImg.badgeUrl.startsWith('data:image/png;base64,'));
  assert(store.getBytes('badge').equals(pngHeader));

  const cleared = await store.clear('badge');
  assert.equal(cleared.hasBadge, false);
  assert.equal(store.getBytes('badge'), null);
});

test('session history store deduplicates consecutive snapshots, formats Markdown/CSV safely, and clears cleanly', async () => {
  let disk = null;
  const fsMock = {
    readFile: async () => { if (!disk) throw Object.assign(new Error(), { code: 'ENOENT' }); return disk; },
    writeFile: async (_p, data) => { disk = data; },
    rename: async () => {},
  };
  const store = createSessionHistoryStore({
    fs: fsMock,
    getPath: () => '/virtual/play-history.v1.json',
    atomicRename: async () => {},
    crypto,
  });

  await store.record({ snapshot: { id: 's1', messageId: 'm1', nickname: '小铃', text: '第一封直播来信', assets: [{ id: 'a1' }] }, siteLabel: 'UliUli', topicTitle: '日常箱' });
  // Duplicate snapshotId is ignored
  await store.record({ snapshot: { id: 's1', messageId: 'm1', nickname: '小铃', text: '第一封直播来信', assets: [{ id: 'a1' }] }, siteLabel: 'UliUli', topicTitle: '日常箱' });
  await store.record({ snapshot: { id: 's2', messageId: 'm2', nickname: '=FORMULA()', text: '第二封来信', assets: [] }, siteLabel: 'UliUli', topicTitle: '日常箱' });

  const list = store.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].snapshotId, 's2');
  assert.equal(list[1].assetCount, 1);

  const md = formatMarkdown(list);
  assert(md.includes('# 风铃直播读信复盘清单'));
  assert(md.includes('第一封直播来信'));
  assert(md.includes('含 1 张图'));

  const csv = formatCsv(list);
  assert(csv.startsWith('\uFEFF'));
  // Formula injection neutralized in CSV export
  assert(csv.includes("\"'=FORMULA()\""));

  await store.clear();
  assert.equal(store.list().length, 0);
});
