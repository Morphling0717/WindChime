import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import {
  computeRedactorCanvasSize,
  pixelateRectData,
  pixelateBrushSegmentData,
} from '../dist/broadcast/ImageRedactorModal.js';
import { filterAndOrderPending } from '../dist/broadcast/BlindBoxStudio.js';
import { WindChimeLiveCard } from '../dist/broadcast/Display.js';
import { OnAirTeleprompter } from '../dist/broadcast/Teleprompter.js';
import { startDisplayScroll } from '../dist/broadcast/scroll-loop.js';
import { createWindChimeClient } from '../dist/client/index.js';
import { DEFAULT_WINDCHIME_LIVE_APPEARANCE as appearance } from '../dist/core/live.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('ImageRedactorModal pure helpers clamp dimensions and average mosaic blocks without leaking outside pixels', () => {
  assert.deepEqual(computeRedactorCanvasSize(1200, 800, 2400), { width: 1200, height: 800 });
  assert.deepEqual(computeRedactorCanvasSize(4800, 2400, 2400), { width: 2400, height: 1200 });

  // 8x8 RGBA image: top-left 4x4 block has alternating 0 and 200 red pixels -> average 100
  const w = 8;
  const h = 8;
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      src[idx] = (x + y) % 2 === 0 ? 0 : 200;
      src[idx + 1] = 40;
      src[idx + 2] = 80;
      src[idx + 3] = 255;
    }
  }
  const dst = new Uint8ClampedArray(src);
  pixelateRectData(src, dst, w, h, 0, 0, 4, 4, 4);
  // Inside redacted block (0..3, 0..3): red channel averaged to 100
  assert.equal(dst[0], 100);
  assert.equal(dst[(3 * w + 3) * 4], 100);
  // Outside redacted block (4, 4): untouched original 0
  assert.equal(dst[(4 * w + 4) * 4], 0);
  assert.equal(dst[(4 * w + 5) * 4], 200);

  // Brush stroke over bottom-right block (6,6)
  const dstBrush = new Uint8ClampedArray(src);
  pixelateBrushSegmentData(src, dstBrush, w, h, { x: 5, y: 5 }, { x: 7, y: 7 }, 3, 4);
  assert.equal(dstBrush[(6 * w + 6) * 4], 100);
  // Top-left block untouched by brush
  assert.equal(dstBrush[0], 0);
});

test('filterAndOrderPending filters by attachment presence and orders oldest/newest cleanly', () => {
  const mk = (id, createdAt, assets = []) => ({
    id,
    createdAt,
    isRead: false,
    isFavorited: false,
    isFlagged: false,
    status: 'pending',
    snapshotId: null,
    draftRevision: 1,
    source: { nickname: id, text: id, linkUrl: null, assets },
    draft: { nickname: id, text: id, linkUrl: null, assets },
  });
  const list = [
    mk('m-mid', '2026-11-26T10:10:00.000Z', [{ id: 'a1', caption: '' }]),
    mk('m-old', '2026-11-26T10:00:00.000Z', []),
    mk('m-new', '2026-11-26T10:20:00.000Z', [{ id: 'a2', caption: '' }]),
  ];

  assert.deepEqual(filterAndOrderPending(list, 'all', 'oldest').map(m => m.id), ['m-old', 'm-mid', 'm-new']);
  assert.deepEqual(filterAndOrderPending(list, 'all', 'newest').map(m => m.id), ['m-new', 'm-mid', 'm-old']);
  assert.deepEqual(filterAndOrderPending(list, 'media', 'oldest').map(m => m.id), ['m-mid', 'm-new']);
  assert.deepEqual(filterAndOrderPending(list, 'media', 'newest').map(m => m.id), ['m-new', 'm-mid']);
  assert.deepEqual(filterAndOrderPending(list, 'text', 'oldest').map(m => m.id), ['m-old']);
});

test('WindChimeLiveCard renders spotlight overlay only for valid matching assets and supports enhancedMotion', async t => {
  const snapshot = {
    id: 'snap-1',
    messageId: 'm1',
    nickname: '星光猫猫',
    text: '贺图来啦',
    linkUrl: null,
    assets: [
      { id: 'img-1', caption: '风铃贺图', mimeType: 'image/png', width: 800, height: 600, sha256: '' },
      { id: 'img-2', caption: '线稿过程', mimeType: 'image/png', width: 800, height: 600, sha256: '' },
    ],
  };
  const assetUrls = { 'img-1': 'blob:1', 'img-2': 'blob:2' };

  let renderer;
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()); });

  await act(async () => {
    renderer = create(
      React.createElement(WindChimeLiveCard, {
        snapshot,
        appearance,
        assetUrls,
        spotlightAssetId: 'img-2',
        enhancedMotion: true,
      }),
    );
  });
  const article = renderer.root.findByType('article');
  assert.equal(article.props['data-spotlight'], 'true');
  assert(String(article.props.style.animation).includes('wc-display-glass-enter'));
  const spotlight = renderer.root.find(node => node.props.className === 'wc-display-spotlight');
  assert.equal(spotlight.props['data-spotlight-id'], 'img-2');
  assert(JSON.stringify(spotlight.toJSON?.() ?? renderer.toJSON()).includes('2 / 2'));
  assert(JSON.stringify(renderer.toJSON()).includes('线稿过程'));

  // Non-matching asset id never renders a stale spotlight overlay
  await act(async () => {
    renderer.update(
      React.createElement(WindChimeLiveCard, {
        snapshot,
        appearance: { ...appearance, animation: 'none' },
        assetUrls,
        spotlightAssetId: 'stale-other-letter',
        enhancedMotion: true,
      }),
    );
  });
  const updatedArticle = renderer.root.findByType('article');
  assert.equal(updatedArticle.props['data-spotlight'], undefined);
  assert.equal(updatedArticle.props.style.animation, undefined);
  assert.equal(renderer.root.findAll(node => node.props.className === 'wc-display-spotlight').length, 0);
});

test('OnAirTeleprompter toggles spotlight asset callback cleanly', async t => {
  const oldUrl = globalThis.URL;
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:mock-thumb';
  URL.revokeObjectURL = () => {};
  t.after(() => {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    globalThis.URL = oldUrl;
  });

  const calls = [];
  const message = {
    id: 'm-live',
    createdAt: '2026-11-26T12:00:00Z',
    isRead: true,
    isFavorited: false,
    isFlagged: false,
    status: 'approved',
    snapshotId: 'snap-live',
    draftRevision: 1,
    source: { nickname: 'A', text: 'hello', linkUrl: null, assets: [{ id: 'asset-9', caption: '大图' }] },
    draft: { nickname: 'A', text: 'hello', linkUrl: null, assets: [{ id: 'asset-9', caption: '大图' }] },
  };
  const client = {
    asset: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  };

  let renderer;
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()); });
  await act(async () => {
    renderer = create(
      React.createElement(OnAirTeleprompter, {
        client,
        topicId: 't1',
        message,
        onScrollDisplay: () => {},
        spotlightAssetId: null,
        onToggleSpotlight: id => { calls.push(id); },
      }),
    );
    await new Promise(resolve => setImmediate(resolve));
  });

  const btn = renderer.root.findAllByType('button').find(b => b.children.join('').includes('投屏放大'));
  assert(btn, 'Spotlight toggle button should render');
  assert.equal(btn.props.disabled, false);
  await act(async () => { btn.props.onClick(); });
  assert.deepEqual(calls, ['asset-9']);

  await act(async () => {
    renderer.update(
      React.createElement(OnAirTeleprompter, {
        client,
        topicId: 't1',
        message,
        onScrollDisplay: () => {},
        spotlightAssetId: 'asset-9',
        onToggleSpotlight: id => { calls.push(id); },
      }),
    );
  });
  const collapseBtn = renderer.root.findAllByType('button').find(b => b.children.join('').includes('收起放大'));
  assert(collapseBtn, 'Collapse spotlight button should render when active');
  await act(async () => { collapseBtn.props.onClick(); });
  assert.deepEqual(calls, ['asset-9', null]);
});

test('startDisplayScroll freezes during overlay spotlight, preserves manual unpause on hitch, and recovers from still after resize', () => {
  const viewport = { clientHeight: 200, scrollTop: 0, dataset: {} };
  const content = { scrollHeight: 400 };
  let next = 0, now = 0;
  const callbacks = new Map();
  let sendCmd = null;
  let setOverlay = null;
  const clock = { request: cb => { callbacks.set(++next, cb); return next; }, cancel: id => callbacks.delete(id) };
  const stop = startDisplayScroll(viewport, content, {
    enabled: false,
    speed: 100,
    startPauseMs: 50,
    endPauseMs: 50,
    control: { subscribe: fn => { sendCmd = fn; return () => { sendCmd = null; }; } },
    overlayPaused: false,
    subscribeOverlayPause: fn => { setOverlay = fn; return () => { setOverlay = null; }; },
  }, clock);
  const advance = ms => {
    now += ms;
    const batch = [...callbacks.values()];
    callbacks.clear();
    for (const cb of batch) cb(now);
  };
  advance(0);
  sendCmd({ type: 'togglePause', paused: false });
  advance(200);
  assert.equal(viewport.scrollTop, 20);
  // Spotlight overlay pauses scrolling without resetting offset
  setOverlay(true);
  advance(1000);
  assert.equal(viewport.scrollTop, 20);
  setOverlay(false);
  advance(100);
  assert.equal(viewport.scrollTop, 20); // first frame after resume establishes timestamp cleanly
  advance(100);
  assert.equal(viewport.scrollTop, 30);
  // Frame hitch (>500ms) restarts from top while keeping manual unpause active
  advance(800);
  assert.equal(viewport.scrollTop, 0);
  assert.equal(viewport.dataset.scrollPhase, 'top');
  advance(60);
  assert.equal(viewport.dataset.scrollPhase, 'scrolling');
  // Resizing taller than content enters still, then shrinking back recovers scrolling
  viewport.clientHeight = 500;
  advance(16);
  assert.equal(viewport.dataset.scrollPhase, 'still');
  viewport.clientHeight = 200;
  advance(16);
  assert.equal(viewport.dataset.scrollPhase, 'scrolling');
  stop();
});

test('createWindChimeClient merges topicId cleanly without duplicating query parameters', async () => {
  const seenUrls = [];
  const client = createWindChimeClient({
    endpoints: { messages: '/custom/messages?topicId=old&extra=1' },
    fetch: async url => {
      seenUrls.push(String(url));
      return new Response(JSON.stringify({ items: [], counts: { all: 0, unread: 0, favorited: 0, flagged: 0 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  await client.messages.list({ filter: 'unread', topicId: 'fresh-topic' });
  assert.equal(seenUrls.length, 1);
  const parsed = new URL(seenUrls[0], 'https://example.test');
  assert.deepEqual(parsed.searchParams.getAll('topicId'), ['fresh-topic']);
  assert.equal(parsed.searchParams.get('extra'), '1');
  assert.equal(parsed.searchParams.get('filter'), 'unread');
});
