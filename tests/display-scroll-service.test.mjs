import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWindChimeSqlite } from '../dist/sqlite/index.js';
import { createWindChimeService } from '../dist/server/index.js';

test('fixed viewport and loop settings persist, default old data safely and reject malformed values atomically', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'windchime-scroll-'));
  const storage = createWindChimeSqlite({ filename: join(directory, 'mail.db') });
  const service = createWindChimeService({ storage, hashSalt: 'test', runtimeEpoch: 'scroll-test' });
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }); });
  await service.ready();
  const defaults = (await service.broadcast.state('default')).appearance;
  assert.equal(defaults.viewportHeight, 640); assert.equal(defaults.autoScroll, true);
  assert.equal(defaults.scrollSpeed, 24); assert.equal(defaults.scrollStartPauseMs, 2000); assert.equal(defaults.scrollEndPauseMs, 2500);
  assert.equal(defaults.imageHeightPercent, 45);
  async function patch(appearance) {
    const state = await service.broadcast.state('default');
    return service.broadcast.action({ action: 'appearance', topicId: 'default', operationId: randomUUID(), expectedRevision: state.revision, appearance });
  }
  const chosen = { layout: 'sidebar', viewportHeight: 800, maxWidth: 360, autoScroll: false, scrollSpeed: 35, scrollStartPauseMs: 3200, scrollEndPauseMs: 4000, imageHeightPercent: 52 };
  const saved = await patch(chosen);
  for (const key of Object.keys(chosen)) assert.equal(saved.appearance[key], chosen[key]);
  assert.equal(saved.current, null); assert.deepEqual(saved.queue, []);
  const restarted = createWindChimeService({ storage, hashSalt: 'test', runtimeEpoch: 'new-process' });
  await restarted.ready();
  assert.deepEqual((await restarted.broadcast.state('default')).appearance, saved.appearance);
  for (const theme of ['pure', 'uliuli', 'mia']) for (const layout of ['stack', 'split', 'banner', 'sidebar', 'portrait', 'focus', 'card', 'letter', 'minimal']) {
    const composed = await patch({ layout, theme });
    assert.equal(composed.appearance.layout, layout); assert.equal(composed.appearance.theme, theme);
    assert.equal(composed.appearance.imageHeightPercent, chosen.imageHeightPercent);
  }
  for (const edge of [{ viewportHeight: 180, scrollSpeed: 5, scrollStartPauseMs: 0, scrollEndPauseMs: 0, imageHeightPercent: 20 }, { viewportHeight: 1080, scrollSpeed: 120, scrollStartPauseMs: 15000, scrollEndPauseMs: 15000, imageHeightPercent: 70 }]) await patch(edge);
  const before = await service.broadcast.state('default');
  for (const invalid of [{ viewportHeight: 179 }, { viewportHeight: 1081 }, { scrollSpeed: 0 }, { scrollSpeed: 121 }, { scrollStartPauseMs: -1 }, { scrollEndPauseMs: 15001 }, { autoScroll: 'true' }, { autoScroll: 1 }, { scrollSpeed: NaN }, { viewportHeight: Infinity }, { scrollEndPauseMs: null }, { imageHeightPercent: 19.99 }, { imageHeightPercent: 70.01 }, { imageHeightPercent: '45' }, { imageHeightPercent: null }, { imageHeightPercent: Infinity }, { imageHeightPercent: NaN }, { layout: 'horizontal-gallery' }]) {
    await assert.rejects(patch(invalid), error => error.code === 'INVALID_APPEARANCE');
    assert.deepEqual(await service.broadcast.state('default'), before);
  }
  await storage.run("UPDATE mail_live_channels SET appearance='{}' WHERE topic_id='default'");
  assert.deepEqual((await service.broadcast.state('default')).appearance, defaults, 'old JSON receives loop defaults without changing approval or queue');
});
