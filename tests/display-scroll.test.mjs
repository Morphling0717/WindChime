import test from 'node:test';
import assert from 'node:assert/strict';
import { startDisplayScroll } from '../dist/broadcast/scroll-loop.js';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { WindChimeLiveCard } from '../dist/broadcast/Display.js';
import { DEFAULT_WINDCHIME_LIVE_APPEARANCE } from '../dist/core/live.js';

function fixture(overrides = {}) {
  const viewport = { clientHeight: 200, scrollTop: 0, dataset: {} }, content = { scrollHeight: 300 };
  let next = 0, now = 0;
  const callbacks = new Map(), history = [];
  const clock = { request: callback => { callbacks.set(++next, callback); return next; }, cancel: id => callbacks.delete(id) };
  const stop = startDisplayScroll(viewport, content, { enabled: true, speed: 100, startPauseMs: 100, endPauseMs: 200, ...overrides }, clock);
  function advance(ms) {
    now += ms;
    const batch = [...callbacks.values()]; callbacks.clear();
    for (const callback of batch) callback(now);
    history.push({ offset: viewport.scrollTop, phase: viewport.dataset.scrollPhase });
  }
  return { viewport, content, advance, stop, callbacks, history };
}

test('long letters pause at both ends, scroll at the configured speed, then loop only the current mounted content', () => {
  const f = fixture(); f.advance(0); f.advance(99);
  assert.equal(f.viewport.scrollTop, 0); assert.equal(f.viewport.dataset.scrollPhase, 'top');
  f.advance(1); assert.equal(f.viewport.dataset.scrollPhase, 'scrolling');
  f.advance(250); assert.equal(f.viewport.scrollTop, 25);
  f.advance(500); f.advance(250);
  assert.equal(f.viewport.scrollTop, 100); assert.equal(f.viewport.dataset.scrollPhase, 'bottom');
  f.advance(199); assert.equal(f.viewport.scrollTop, 100);
  f.advance(1); assert.equal(f.viewport.scrollTop, 0); assert.equal(f.viewport.dataset.scrollPhase, 'top');
  f.stop(); assert.equal(f.callbacks.size, 0);
});

test('short content and explicitly disabled loops stay at the top', () => {
  for (const enabled of [true, false]) {
    const f = fixture({ enabled });
    if (enabled) f.content.scrollHeight = 100;
    for (let n = 0; n < 20; n++) f.advance(100);
    assert.equal(f.viewport.scrollTop, 0); assert.equal(f.viewport.dataset.scrollPhase, 'still');
    f.stop();
  }
});

test('new image dimensions, resized viewport and suspended frames restart at the top', () => {
  const f = fixture(); f.advance(0); f.advance(100); f.advance(300);
  assert.equal(f.viewport.scrollTop, 30);
  f.content.scrollHeight = 500; f.advance(16);
  assert.equal(f.viewport.scrollTop, 0); assert.equal(f.viewport.dataset.scrollPhase, 'top');
  f.advance(100); f.advance(300); f.viewport.clientHeight = 250; f.advance(16);
  assert.equal(f.viewport.scrollTop, 0);
  f.advance(100); f.advance(300); f.advance(4000);
  assert.equal(f.viewport.scrollTop, 0); assert.equal(f.viewport.dataset.scrollPhase, 'top');
  f.stop();
});

test('hide or replacement cancellation prevents even an already-queued old callback from repainting', () => {
  const f = fixture(); f.advance(0); f.advance(100); f.advance(100);
  const oldCallback = [...f.callbacks.values()][0];
  f.stop(); f.viewport.scrollTop = 0;
  oldCallback(500);
  assert.equal(f.viewport.scrollTop, 0); assert.equal(f.callbacks.size, 0);
});

test('equal fresh polling objects do not restart scrolling, but new appearance replaces the scrolling subtree', async () => {
  const oldRequest = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const callbacks = new Map(), viewports = [];
  let id = 0, stamp = 0, renderer;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = callback => { callbacks.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = id => callbacks.delete(id);
  const props = { appearance: { ...DEFAULT_WINDCHIME_LIVE_APPEARANCE }, snapshot: { id: 'approved', messageId: 'mail', nickname: null, text: 'Approved content', linkUrl: null, assets: [] }, assetUrls: {} };
  const advance = () => { stamp += 100; const pending = [...callbacks.values()]; callbacks.clear(); for (const callback of pending) callback(stamp); };
  try {
    await act(async () => { renderer = create(React.createElement(WindChimeLiveCard, props), { createNodeMock: element => {
      if (element.props.className === 'wc-display-viewport') { const viewport = { clientHeight: 200, scrollTop: 0, dataset: {} }; viewports.push(viewport); return viewport; }
      if (element.props.className === 'wc-display-grid') return { scrollHeight: 500 };
      return null;
    } }); });
    for (let step = 0; step < 24; step++) advance();
    assert(viewports[0].scrollTop > 0);
    const previousOffset = viewports[0].scrollTop;
    await act(async () => renderer.update(React.createElement(WindChimeLiveCard, structuredClone(props))));
    advance(); assert.equal(viewports.length, 1); assert(viewports[0].scrollTop > previousOffset, 'normal one-second poll refresh must not prevent the loop from progressing');
    const detachedCallback = [...callbacks.values()][0], detachedOffset = viewports[0].scrollTop;
    await act(async () => renderer.update(React.createElement(WindChimeLiveCard, { ...props, appearance: { ...props.appearance, scrollSpeed: 36 } })));
    assert.equal(viewports.length, 2); assert.equal(viewports[1].scrollTop, 0);
    detachedCallback(stamp + 100); assert.equal(viewports[0].scrollTop, detachedOffset);
    await act(async () => renderer.unmount()); renderer = null;
    assert.equal(callbacks.size, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.requestAnimationFrame = oldRequest; globalThis.cancelAnimationFrame = oldCancel; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
  }
});
