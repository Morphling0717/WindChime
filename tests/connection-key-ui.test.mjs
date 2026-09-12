import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { WindChimeLiveControlPanel } from '../dist/broadcast/ControlPanel.js';
import { createWindChimeLiveClient, createWindChimeDisplayClient } from '../dist/client/live.js';
import { parseWindChimeConnectionKey } from '../dist/core/connection-key.js';
import { DEFAULT_WINDCHIME_LIVE_APPEARANCE as appearance } from '../dist/core/live.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => new Promise(resolve => setImmediate(resolve));
function clientFixture(siteId = 'site-A') {
  const grants = [], created = [], revoked = [];
  const token = `wc_ctl_${siteId === 'site-A' ? 'A'.repeat(43) : 'B'.repeat(43)}`;
  const client = {
    capabilities: async () => ({ protocolVersion: 1, siteId, basePath: '/api/mail/live', features: { connectionKeys: true }, pollIntervalMs: 1000, leaseMs: 3000 }),
    state: async topicId => ({ topicId, revision: 1, epoch: siteId, messages: [], queue: [], current: null, appearance, receivers: 0 }),
    grants: async topicId => ({ items: structuredClone(grants.filter(grant => grant.topicId === topicId)) }),
    createGrant: async (topicId, kind, label) => {
      created.push([topicId, kind, label]);
      const grant = { id: `${siteId}-${created.length}`, topicId, kind, label, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), revokedAt: null };
      grants.push(grant);
      return { ...grant, token };
    },
    revokeGrant: async (topicId, id) => { revoked.push([topicId, id]); grants.find(grant => grant.id === id).revokedAt = new Date().toISOString(); },
    approveDevice: async () => ({ ok: true }),
  };
  return { client, grants, created, revoked, token };
}
async function renderFixture(t, options = {}) {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const writes = [];
  const forbidden = () => { throw new Error('Connection keys must not be persisted or placed in URLs'); };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: Object.freeze({ origin: 'https://mail.example.test', hash: '', search: '' }), history: { replaceState: forbidden, pushState: forbidden }, get localStorage() { return forbidden(); }, get sessionStorage() { return forbidden(); } } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { writes.push(value); } } } });
  const backend = options.backend ?? clientFixture();
  let props = { client: backend.client, topicId: 'topic-A', ...options.props }, renderer;
  const commits = [];
  const element = () => React.createElement(React.Profiler, { id: 'connection-boundary', onRender: () => { if (renderer) commits.push(JSON.stringify(renderer.toJSON())); } }, React.createElement(WindChimeLiveControlPanel, props));
  await act(async () => { renderer = create(element()); });
  t.after(async () => {
    await act(async () => { renderer.unmount(); });
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete globalThis.window;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else delete globalThis.navigator;
  });
  const button = text => renderer.root.findAllByType('button').find(node => node.children.join('') === text);
  const click = async text => { const target = button(text); assert(target, `Missing button: ${text}`); assert(!target.props.disabled, `Disabled button: ${text}`); await act(async () => { target.props.onClick(); await settle(); }); };
  const name = async value => { await act(async () => { renderer.root.findAllByType('label').find(node => node.children[0] === '连接名称').findByType('input').props.onChange({ target: { value } }); }); };
  const key = () => renderer.root.findAllByType('textarea').find(node => node.props['aria-label'] === '桌面连接密钥')?.props.value;
  const update = async next => { props = { ...props, ...next }; commits.length = 0; await act(async () => { renderer.update(element()); await settle(); }); };
  return { ...backend, renderer, commits, button, click, name, key, update, writes };
}

test('named connection key is reusable, scoped, shown only in memory and copied explicitly', async t => {
  const f = await renderFixture(t);
  assert.equal(f.button('生成桌面连接密钥').props.disabled, true);
  await f.name('  直播电脑  '); await f.click('生成桌面连接密钥');
  assert.deepEqual(f.created, [['topic-A', 'control', '直播电脑']]);
  const key = f.key();
  assert.deepEqual(parseWindChimeConnectionKey(key), { v: 1, origin: 'https://mail.example.test', siteId: 'site-A', token: f.token });
  assert.equal(f.writes.length, 0, 'generating a key must not write the clipboard automatically');
  await f.click('复制连接密钥'); await f.click('复制连接密钥');
  assert.deepEqual(f.writes, [key, key]); assert.equal(f.created.length, 1);
  const rendered = JSON.stringify(f.renderer.toJSON());
  for (const text of ['直播电脑', '话题：', 'topic-A', '到期', '30 天', '多台电脑', '所有电脑断开']) assert(rendered.includes(text));
  assert(rendered.includes(new Date(f.grants[0].expiresAt).toLocaleString('zh-CN')));
  await f.click('隐藏本页密钥'); assert.equal(f.key(), undefined); assert.equal(f.revoked.length, 0);
});

test('empty names and unsupported servers create no grants', async t => {
  const f = await renderFixture(t);
  await f.name('   ');
  await act(async () => { f.button('生成桌面连接密钥').props.onClick(); await settle(); });
  assert.equal(f.created.length, 0); assert(JSON.stringify(f.renderer.toJSON()).includes('请先填写连接名称'));
  f.client.capabilities = async () => ({ protocolVersion: 1, siteId: 'site-A', features: { connectionKeys: false } });
  await f.name('My computer'); await f.click('生成桌面连接密钥');
  assert.equal(f.created.length, 0); assert.equal(f.key(), undefined);
  assert(JSON.stringify(f.renderer.toJSON()).includes('本站尚不支持连接密钥'));
});

for (const boundary of ['client', 'topic', 'authority']) test(`${boundary} changes cannot commit a previous connection key`, async t => {
  const f = await renderFixture(t); await f.name('Private A'); await f.click('生成桌面连接密钥'); const key = f.key(); assert(key);
  await f.update(boundary === 'client' ? { client: clientFixture('site-B').client } : boundary === 'topic' ? { topicId: 'topic-B' } : { canApproveDevices: false });
  assert.equal(f.key(), undefined);
  assert(f.commits.length > 0);
  assert(f.commits.every(commit => !commit.includes(key)), 'even the first commit at the new boundary must not expose the old key');
  if (boundary === 'authority') {
    assert.equal(f.button('生成桌面连接密钥'), undefined);
    await f.update({ canApproveDevices: true }); assert.equal(f.key(), undefined);
  }
});

for (const boundary of ['client', 'topic']) test(`late generation cannot populate another ${boundary}`, async t => {
  const backend = clientFixture(); const createGrant = backend.client.createGrant; let finish;
  backend.client.createGrant = async (...args) => { const grant = await createGrant(...args); return new Promise(resolve => { finish = () => resolve(grant); }); };
  const f = await renderFixture(t, { backend }); await f.name('Old request'); await f.click('生成桌面连接密钥'); assert(finish);
  await f.update(boundary === 'client' ? { client: clientFixture('site-B').client } : { topicId: 'topic-B' });
  await act(async () => { finish(); await settle(); });
  assert.equal(f.key(), undefined); assert.equal(f.button('生成桌面连接密钥').props.disabled, true, 'the new scope has an empty name');
  assert(!JSON.stringify(f.renderer.toJSON()).includes('Old request'));
});

test('late capability response cannot create a grant for an abandoned client', async t => {
  const backend = clientFixture(); const capabilities = await backend.client.capabilities(); let finish;
  backend.client.capabilities = () => new Promise(resolve => { finish = () => resolve(capabilities); });
  const f = await renderFixture(t, { backend }); await f.name('Old scope'); await f.click('生成桌面连接密钥');
  await f.update({ client: clientFixture('site-B').client });
  await act(async () => { finish(); await settle(); });
  assert.equal(backend.created.length, 0); assert.equal(f.key(), undefined);
});

test('revoking the generated grant removes the visible key and describes shared-device invalidation', async t => {
  const f = await renderFixture(t); await f.name('Shared computers'); await f.click('生成桌面连接密钥');
  await f.click('撤销');
  assert.deepEqual(f.revoked, [['topic-A', f.grants[0].id]]); assert.equal(f.key(), undefined);
  assert(JSON.stringify(f.renderer.toJSON()).includes('使用此授权的所有电脑将断开'));
  assert(JSON.stringify(f.renderer.toJSON()).includes('已撤销'));
});

test('an older initial grant list cannot clear a newly created connection key', async t => {
  const backend = clientFixture(); const grants = backend.client.grants; let finish, first = true;
  backend.client.grants = topicId => { if (!first) return grants(topicId); first = false; return new Promise(resolve => { finish = () => resolve({ items: [] }); }); };
  const f = await renderFixture(t, { backend }); await f.name('New key'); await f.click('生成桌面连接密钥'); const key = f.key(); assert(key);
  await act(async () => { finish(); await settle(); }); assert.equal(f.key(), key);
});

test('legacy pairing is collapsed by default and opens for an incoming device code', async t => {
  const f = await renderFixture(t);
  const legacy = () => f.renderer.root.findAllByType('details').find(node => node.findByType('summary').children.join('') === '旧版设备配对');
  assert.equal(legacy().props.open, false);
  await f.update({ deviceCode: 'PAIR-1234' });
  assert.equal(legacy().props.open, true);
  assert(legacy().findAllByType('input').some(input => input.props.value === 'PAIR-1234'));
  await f.update({ canApproveDevices: false });
  assert.equal(f.button('生成桌面连接密钥'), undefined); assert.equal(f.button('批准此设备连接当前信箱'), undefined);
});

test('control client exposes typed identity/capability routes without adding them to the display client', async () => {
  const calls = [], signal = new AbortController().signal;
  const client = createWindChimeLiveClient({ transport: async request => { calls.push(request); return { ok: true }; } });
  await client.capabilities(signal); await client.identity(signal);
  assert.deepEqual(calls, [{ path: '/capabilities', method: 'GET', signal }, { path: '/control/identity', method: 'GET', signal }]);
  const display = createWindChimeDisplayClient({ transport: async () => ({}) });
  assert.equal(display.identity, undefined); assert.equal(display.capabilities, undefined); assert.equal(display.createGrant, undefined);
});
