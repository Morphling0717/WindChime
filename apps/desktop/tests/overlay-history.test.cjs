const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { createOverlayStore, isValidImageBuffer } = require('../main/overlay-store.cjs');
const {
  createSessionHistoryStore,
  formatRelativeOffset,
  formatBilibiliChapters,
  formatMarkdown,
  formatCsv,
} = require('../main/session-history.cjs');

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

test('session history computes Bilibili VOD chapter timeline from streamStartedAt and persists across reads', async () => {
  assert.equal(formatRelativeOffset('2026-11-26T20:18:32.000Z', '2026-11-26T20:00:00.000Z'), '00:18:32');
  assert.equal(formatRelativeOffset('2026-11-26T21:05:09.000Z', '2026-11-26T20:00:00.000Z'), '01:05:09');
  assert.equal(formatRelativeOffset('2026-11-26T19:50:00.000Z', '2026-11-26T20:00:00.000Z'), '00:00:00');

  // Reverse-chronological entries as stored in play-history.v1.json
  const sampleEntries = [
    {
      id: '3',
      snapshotId: 's3',
      messageId: 'm3',
      playedAt: '2026-11-26T20:32:10.000Z',
      dateKey: '2026-11-26',
      siteLabel: 'UliUli',
      topicTitle: '日常箱',
      nickname: null,
      textSnippet: '祝主播早点休息',
      assetCount: 0,
    },
    {
      id: '2',
      snapshotId: 's2',
      messageId: 'm2',
      playedAt: '2026-11-26T20:15:05.000Z',
      dateKey: '2026-11-26',
      siteLabel: 'UliUli',
      topicTitle: '日常箱',
      nickname: '星光猫猫',
      textSnippet: '给你画了一张超好看的琉璃风铃贺图希望你会喜欢这份小惊喜呀',
      assetCount: 1,
    },
    {
      id: '1',
      snapshotId: 's1',
      messageId: 'm1',
      playedAt: '2026-11-25T20:05:00.000Z',
      dateKey: '2026-11-25',
      siteLabel: 'UliUli',
      topicTitle: '昨日箱',
      nickname: '昨天观众',
      textSnippet: '昨天的信不应混入今天',
      assetCount: 0,
    },
  ];

  // With explicit streamStartedAt: adds 00:00:00 intro and excludes yesterday
  const chapters = formatBilibiliChapters(sampleEntries, { streamStartedAt: '2026-11-26T20:00:00.000Z' });
  const lines = chapters.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], '00:00:00 开场 / 读信开始');
  assert(lines[1].startsWith('00:15:05 星光猫猫 - '));
  assert(lines[1].endsWith('…'));
  assert.equal(lines[2], '00:32:10 匿名来信 - 祝主播早点休息');

  // Without streamStartedAt: defaults to latest session day starting from earliest entry
  const fallbackChapters = formatBilibiliChapters(sampleEntries);
  const fbLines = fallbackChapters.split('\n');
  assert.equal(fbLines.length, 2);
  assert(fbLines[0].startsWith('00:00:00 星光猫猫 - '));
  assert.equal(fbLines[1], '00:17:05 匿名来信 - 祝主播早点休息');

  // CSV & Markdown include relative timeline when streamStartedAt is set
  const mdWithVod = formatMarkdown(sampleEntries, '2026-11-26', { streamStartedAt: '2026-11-26T20:00:00.000Z' });
  assert(mdWithVod.includes('[00:15:05]'));
  const csvWithVod = formatCsv(sampleEntries, '2026-11-26', { streamStartedAt: '2026-11-26T20:00:00.000Z' });
  assert(csvWithVod.includes('"录播时间轴"'));
  assert(csvWithVod.includes('"00:15:05"'));

  // Persistence round-trip for streamStartedAt
  let disk = null;
  const startNotifications = [];
  const makeStore = () => createSessionHistoryStore({
    fs: {
      readFile: async () => { if (!disk) throw Object.assign(new Error(), { code: 'ENOENT' }); return disk; },
      writeFile: async (_p, data) => { disk = data; },
      rename: async () => {},
    },
    getPath: () => '/virtual/play-history.v1.json',
    atomicRename: async () => {},
    crypto,
    onStreamStartChanged: iso => startNotifications.push(iso),
  });
  const s1 = makeStore();
  await s1.setStreamStartedAt('2026-11-26T20:00:00.000Z');
  assert.equal(s1.getStreamStartedAt(), '2026-11-26T20:00:00.000Z');
  assert.deepEqual(startNotifications, ['2026-11-26T20:00:00.000Z']);
  const s2 = makeStore();
  await s2.read();
  assert.equal(s2.getStreamStartedAt(), '2026-11-26T20:00:00.000Z');
  await s2.setStreamStartedAt(null);
  assert.equal(s2.getStreamStartedAt(), null);

  // Offset seconds & frame-accurate OBS WebSocket encoder timecode priority (survives recording pauses!)
  const pausedEntries = [
    {
      ...sampleEntries[0],
      obsRecordMs: 12 * 60 * 1000 + 34000, // 00:12:34 despite wall-clock being 00:32:10 (paused ~20 min)
    },
  ];
  const pausedChapters = formatBilibiliChapters(pausedEntries, {
    streamStartedAt: '2026-11-26T20:00:00.000Z',
    streamStartSource: 'obs-ws-record',
    timelineOffsetSec: -14, // trimmed 14s intro -> 00:12:20
  });
  assert(pausedChapters.includes('00:12:20 匿名来信 - 祝主播早点休息'));

  await s1.setStreamStartedAt('2026-11-26T20:00:00.000Z', { source: 'bilibili', label: 'B站直播间 #223344' });
  await s1.setTimelineOffsetSec(-30);
  const s3 = makeStore();
  await s3.read();
  assert.equal(s3.getTimelineMeta().streamStartSource, 'bilibili');
  assert.equal(s3.getTimelineMeta().streamStartLabel, 'B站直播间 #223344');
  assert.equal(s3.getTimelineMeta().timelineOffsetSec, -30);

  // Concurrent record() + setStreamStartedAt() never lose either update
  await Promise.all([
    s3.record({ snapshot: { id: 'conc-1', messageId: 'cm1', nickname: '并发测试', text: '不会丢失', assets: [] }, siteLabel: 'S', topicTitle: 'T' }),
    s3.setStreamStartedAt('2026-11-26T20:05:00.000Z', { source: 'manual', label: '手动标记' }),
  ]);
  assert.equal(s3.list().length, 1);
  assert.equal(s3.getStreamStartedAt(), '2026-11-26T20:05:00.000Z');

  // CSV formula escaping blocks leading whitespace + formula prefix
  const formulaCsv = formatCsv([{ ...sampleEntries[0], nickname: '  =HYPERLINK("http://evil")', textSnippet: '\t+1+1' }]);
  assert(formulaCsv.includes(`"'  =HYPERLINK(`));
  assert(formulaCsv.includes(`"'\t+1+1"`));

  // Entry with direct obsRecordMs survives pause-shifted startMs > playedAt
  const preShiftChapters = formatBilibiliChapters(
    [{ ...sampleEntries[1], obsRecordMs: 90000 }],
    { streamStartedAt: '2026-11-26T20:20:00.000Z', streamStartSource: 'obs-ws-record' },
  );
  assert(preShiftChapters.includes('00:01:30 星光猫猫'));
});

test('overlay store parses WebP headers safely and falls back when nativeImage cannot decode WebP', async () => {
  const { parseWebpSize, createOverlayStore } = require('../main/overlay-store.cjs');
  // Valid VP8X WebP 320x240 header (30 bytes)
  const vp8x = Buffer.alloc(30);
  vp8x.write('RIFF', 0, 'ascii');
  vp8x.writeUInt32LE(22, 4);
  vp8x.write('WEBP', 8, 'ascii');
  vp8x.write('VP8X', 12, 'ascii');
  vp8x.writeUInt32LE(10, 16);
  const wMinus1 = 319;
  const hMinus1 = 239;
  vp8x[24] = wMinus1 & 0xff; vp8x[25] = (wMinus1 >> 8) & 0xff; vp8x[26] = (wMinus1 >> 16) & 0xff;
  vp8x[27] = hMinus1 & 0xff; vp8x[28] = (hMinus1 >> 8) & 0xff; vp8x[29] = (hMinus1 >> 16) & 0xff;
  assert.deepEqual(parseWebpSize(vp8x), { width: 320, height: 240 });

  // Oversized VP8X WebP (5000x5000 = 25M px > 16M limit) rejected
  const huge = Buffer.from(vp8x);
  const big = 4999;
  huge[24] = big & 0xff; huge[25] = (big >> 8) & 0xff; huge[26] = (big >> 16) & 0xff;
  huge[27] = big & 0xff; huge[28] = (big >> 8) & 0xff; huge[29] = (big >> 16) & 0xff;
  assert.equal(parseWebpSize(huge), null);

  let savedFile = null;
  const store = createOverlayStore({
    fs: { mkdir: async () => {}, writeFile: async (_p, b) => { savedFile = b; }, readFile: async () => { throw new Error('ENOENT'); }, unlink: async () => {} },
    path: require('node:path'),
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) }) },
    dialog: {},
    getDir: () => '/virtual/overlay',
    getConfig: () => ({}),
    saveConfig: async () => {},
  });
  const res = await store.saveImageBytes('background', vp8x);
  assert.equal(res.hasBackground, true);
  assert(res.backgroundUrl.startsWith('data:image/webp;base64,'));
  assert(Buffer.isBuffer(savedFile) && savedFile.equals(vp8x));
});
