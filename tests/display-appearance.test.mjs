import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyLiveTheme, resolveLiveLayout, LIVE_THEMES } from '../dist/broadcast/appearance.js';
import { WindChimeLiveCard } from '../dist/broadcast/Display.js';
import { DEFAULT_WINDCHIME_LIVE_APPEARANCE } from '../dist/core/live.js';

const snapshot = Object.freeze({
  id: 'snapshot-approved', messageId: 'message-reviewed',
  text: '第一行 & 第二行\n</div><script>alert("private")</script>\n最后一行 🌙',
  nickname: '昵称 <朋友> & "来信人"',
  linkUrl: 'https://example.test/letter?a=<script>&b="quoted"',
  assets: Object.freeze([
    Object.freeze({ id: 'asset-z', caption: '第一张 <img src=x onerror="alert(1)">', mimeType: 'image/webp', width: 200, height: 160, sha256: 'z'.repeat(64) }),
    Object.freeze({ id: 'asset-a', caption: '第二张 & "原顺序"', mimeType: 'image/webp', width: 160, height: 200, sha256: 'a'.repeat(64) }),
    Object.freeze({ id: 'asset-m', caption: '第三张 <svg onload="alert(2)">', mimeType: 'image/webp', width: 200, height: 200, sha256: 'm'.repeat(64) }),
  ]),
});
const assetUrls = Object.freeze(Object.fromEntries(snapshot.assets.map(asset => [asset.id, `blob:https://display.test/${asset.id}`])));
const layouts = ['stack', 'split', 'banner'];
const unchangedKeys = ['layout', 'imageLayout', 'fontSize', 'padding', 'lineHeight', 'letterSpacing', 'maxWidth', 'animation'];
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[char]);
const renderCard = appearance => renderToStaticMarkup(React.createElement(WindChimeLiveCard, { snapshot, appearance, assetUrls }));
function assertInertMarkup(markup) {
  // React escapes quotes inside attribute values. Scan complete opening tags,
  // then discard quoted values so caption text in alt cannot impersonate an attribute.
  const openingTags = /<([a-z][a-z0-9:-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  for (const match of markup.matchAll(openingTags)) {
    assert.notEqual(match[1].toLowerCase(), 'script', 'untrusted text must not create a script element');
    const attributes = match[0].replace(/"[^"]*"|'[^']*'/g, '""');
    assert.doesNotMatch(attributes, /[\s/]on[a-z]+\s*=/i, 'untrusted text must not create an event handler attribute');
  }
}

test('theme selection preserves composition and text metrics without mutating the supplied appearance', () => {
  assert.deepEqual(LIVE_THEMES.map(theme => theme.id), ['pure', 'uliuli', 'mia']);
  for (const layout of [...layouts, 'card', 'letter', 'minimal']) {
    const original = Object.freeze({
      ...DEFAULT_WINDCHIME_LIVE_APPEARANCE, layout, imageLayout: 'row',
      fontSize: 47, padding: 41, lineHeight: 2.1, letterSpacing: -0.6, maxWidth: 937, animation: 'slide',
      theme: 'uliuli', textColor: '#abcdef', backgroundColor: '#102030', accentColor: '#987654',
    });
    const before = structuredClone(original);
    for (const { id: theme } of LIVE_THEMES) {
      const themed = applyLiveTheme(original, theme);
      assert.notEqual(themed, original);
      assert.equal(themed.theme, theme);
      for (const key of unchangedKeys) assert.equal(themed[key], original[key], `${theme} must preserve ${key}`);
      assert.deepEqual(original, before, 'switching skins must not overwrite the saved appearance object');
    }
  }
});

test('layout resolution retains the three new compositions and maps every historical layout to stack', () => {
  for (const layout of layouts) assert.equal(resolveLiveLayout(layout), layout);
  for (const layout of ['card', 'letter', 'minimal']) assert.equal(resolveLiveLayout(layout), 'stack');
});

for (const { id: theme } of LIVE_THEMES) for (const layout of layouts) {
  test(`${theme}/${layout} renders the approved content and ordered media with escaped text and inert links`, () => {
    const appearance = applyLiveTheme({ ...DEFAULT_WINDCHIME_LIVE_APPEARANCE, layout, imageLayout: 'grid' }, theme);
    const before = structuredClone(snapshot);
    const html = renderCard(appearance);
    const markup = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
    assert.match(markup, new RegExp(`data-theme="${theme}"`));
    assert.match(markup, new RegExp(`data-layout="${layout}"`));
    assert.match(markup, /data-arrangement="grid"/);
    assert.match(markup, /data-windchime-snapshot="snapshot-approved"/);
    assert.ok(markup.includes(`<div class="wc-display-author">${escapeHtml(snapshot.nickname)}</div>`));
    assert.ok(markup.includes(`<div class="wc-display-text">${escapeHtml(snapshot.text)}</div>`));
    assert.ok(markup.includes(`<div class="wc-display-link">${escapeHtml(snapshot.linkUrl)}</div>`));
    assert.doesNotMatch(markup, /<a\b/i, 'the approved link is display text, never a clickable anchor');
    assertInertMarkup(markup);
    assert.throws(() => assertInertMarkup(markup + '<script>alert(1)</script>'), /script element/);
    assert.throws(() => assertInertMarkup(markup.replace('<img ', '<img onerror="alert(1)" ')), /event handler attribute/);
    const figures = [...markup.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/g)].map(match => match[1]);
    assert.equal(figures.length, snapshot.assets.length);
    for (const [index, asset] of snapshot.assets.entries()) {
      assert.ok(figures[index].includes(`src="${assetUrls[asset.id]}"`), 'rendered images preserve snapshot order');
      assert.ok(figures[index].includes(`alt="${escapeHtml(asset.caption)}"`));
      assert.ok(figures[index].includes(`<figcaption>${escapeHtml(asset.caption)}</figcaption>`));
    }
    const hasBrandOrOrnament = /class="[^"]*\bwc-display-(?:brand|ornament)\b/.test(markup);
    assert.equal(hasBrandOrOrnament, theme !== 'pure', 'pure theme omits decoration elements from the DOM');
    if (theme === 'pure') assert.doesNotMatch(markup, /<svg\b|ULIULI|MIA ·/);
    assert.deepEqual(snapshot, before, 'rendering a theme must not alter approved snapshot data');
  });
}

test('historical appearance objects without theme or new metrics still render as undecorated stacked letters', () => {
  for (const layout of ['card', 'letter', 'minimal']) {
    const legacy = {
      fontFamily: 'Georgia', fontSize: 27, textColor: '#eeeeee', backgroundColor: '#112233ee',
      transparent: false, layout, imageLayout: 'column', animation: 'none', borderRadius: 9, padding: 17,
    };
    const html = renderCard(legacy);
    const markup = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
    assert.match(markup, /data-theme="pure"/);assert.match(markup, /data-layout="stack"/);
    assert.match(markup, /--wc-display-size:27px/);assert.match(markup, /--wc-display-leading:1\.65/);
    assert.match(markup, /--wc-display-tracking:0px/);assert.match(markup, /width:1200px/);
    assert.doesNotMatch(markup, /class="[^"]*\bwc-display-(?:brand|ornament)\b/);
    assert.ok(markup.includes(escapeHtml(snapshot.text)));assert.ok(markup.includes(escapeHtml(snapshot.nickname)));
    assert.equal(legacy.theme, undefined);
  }
});
