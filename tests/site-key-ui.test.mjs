import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { WindChimeConnectionKeys } from '../dist/broadcast/ConnectionKeys.js';
import { parseWindChimeConnectionKey } from '../dist/core/connection-key.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => new Promise(resolve => setImmediate(resolve));
function backend(siteId = 'site-A') {
  const records = [], created = [], revoked = [], paired = [];
  const token = `wc_ctl_${(siteId === 'site-A' ? 'A' : 'B').repeat(43)}`;
  const client = {
    capabilities: async () => ({ siteId, protocolVersion: 1, features: { connectionKeys: true, siteControl: true } }),
    grants: async () => ({ items: structuredClone(records) }),
    createSiteGrant: async label => {
      created.push(label);
      const grant = { id: `${siteId}-${created.length}`, kind: 'control', scope: 'site', topicId: null, label, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), revokedAt: null };
      records.push(grant);
      return { ...grant, token };
    },
    revokeGrant: async (topicId, id) => { revoked.push([topicId, id]); records.find(grant => grant.id === id).revokedAt = new Date().toISOString(); },
    approveDevice: async (...args) => { paired.push(args); return { ok: true }; },
  };
  return { client, records, created, revoked, paired, token };
}

async function fixture(t, data = backend()) {
  const originals = new Map(['window', 'document', 'navigator'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const writes = [], confirms = [], events = new Map();
  const forbidden = () => { throw new Error('Keys must not enter browser persistent storage or URLs'); };
  const addEventListener = (name, callback) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); };
  const removeEventListener = (name, callback) => events.get(name)?.delete(callback);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: Object.freeze({ origin: 'https://mail.example.test' }), addEventListener, removeEventListener, confirm: message => { confirms.push(message); return true; }, history: { pushState: forbidden, replaceState: forbidden }, get localStorage() { return forbidden(); }, get sessionStorage() { return forbidden(); } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible', addEventListener, removeEventListener } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { writes.push(value); } } } });
  let props = { client: data.client, topicId: 'topic-A' }, renderer;
  const commits = [];
  const element = () => React.createElement(React.Profiler, { id: 'site-key', onRender: () => { if (renderer) commits.push(JSON.stringify(renderer.toJSON())); } }, React.createElement(WindChimeConnectionKeys, props));
  await act(async () => { renderer = create(element()); await settle(); });
  t.after(async () => {
    await act(async () => renderer.unmount());
    for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const button = text => renderer.root.findAllByType('button').find(node => node.children.join('') === text);
  const click = async text => { const target = button(text); assert(target, `Missing ${text}`); assert(!target.props.disabled, `Disabled ${text}`); await act(async () => { target.props.onClick(); await settle(); }); };
  const name = async value => { await act(async () => renderer.root.findAllByType('input').find(node => node.props.placeholder === '例如：直播电脑').props.onChange({ target: { value } })); };
  const key = () => renderer.root.findAllByType('textarea').find(node => node.props['aria-label'] === '完整连接密钥')?.props.value;
  const update = async change => { props = { ...props, ...change }; commits.length = 0; await act(async () => { renderer.update(element()); await settle(); }); };
  const event = async name => { await act(async () => { for (const callback of events.get(name) || []) callback(); await settle(); }); };
  return { ...data, renderer, button, click, name, key, update, event, writes, confirms, commits, events };
}

test('site key is named, reusable, copied only on demand and requires current desktop', async t => {
  const f = await fixture(t);
  assert(f.button('生成连接密钥').props.disabled);
  await f.name('  直播电脑  '); await f.click('生成连接密钥');
  assert.deepEqual(f.created, ['直播电脑']);
  const key = f.key();
  assert.deepEqual(parseWindChimeConnectionKey(key), { v: 1, origin: 'https://mail.example.test', siteId: 'site-A', token: f.token });
  assert.equal(f.writes.length, 0);
  await f.click('复制连接密钥'); await f.click('复制连接密钥');
  assert.deepEqual(f.writes, [key, key]); assert.equal(f.created.length, 1);
  for (const text of ['0.7.0', '全站管理', '30 天', '重复连接不会延长']) assert(JSON.stringify(f.renderer.toJSON()).includes(text));
  await f.click('隐藏密钥'); assert.equal(f.key(), undefined); assert.equal(f.revoked.length, 0);
});

for (const boundary of ['topic', 'client']) test(`${boundary} change never commits a previous full key`, async t => {
  const f = await fixture(t); await f.name('Private key'); await f.click('生成连接密钥'); const key = f.key();
  await f.update(boundary === 'topic' ? { topicId: 'topic-B' } : { client: backend('site-B').client });
  assert.equal(f.key(), undefined); assert(f.commits.length);
  assert(f.commits.every(commit => !commit.includes(key)), 'No single committed frame may retain the old key');
  await f.name('New connection'); assert.equal(f.button('生成连接密钥').props.disabled, false);
});

for (const boundary of ['topic', 'client', 'unmount']) test(`late site mint is discarded after ${boundary}`, async t => {
  const b = backend(); const mint = b.client.createSiteGrant; let finish;
  b.client.createSiteGrant = async label => { const grant = await mint(label); return new Promise(resolve => { finish = () => resolve(grant); }); };
  const f = await fixture(t, b); await f.name('Old pending'); await f.click('生成连接密钥'); assert(finish);
  if (boundary === 'unmount') await act(async () => f.renderer.unmount());
  else await f.update(boundary === 'topic' ? { topicId: 'topic-B' } : { client: backend('site-B').client });
  await act(async () => { finish(); await settle(); });
  if (boundary !== 'unmount') { assert.equal(f.key(), undefined); await f.name('New request'); assert.equal(f.button('生成连接密钥').props.disabled, false); }
  else assert.equal(f.renderer.toJSON(), null);
});

test('unsupported server and unauthorized mint keep errors private and expose no key', async t => {
  const b = backend(); const f = await fixture(t, b);
  b.client.capabilities = async () => ({ features: { connectionKeys: true, siteControl: false } });
  await f.name('Test'); await f.click('生成连接密钥');
  assert.equal(f.created.length, 0); assert.equal(f.key(), undefined);
  assert(JSON.stringify(f.renderer.toJSON()).includes('请先升级网站至 0.7.0'));
  b.client.capabilities = async () => ({ siteId: 'site-A', features: { connectionKeys: true, siteControl: true } });
  let unauthorized = 0;
  await f.update({ onUnauthorized: () => { unauthorized++; } });
  b.client.createSiteGrant = async () => { throw Object.assign(new Error('请重新登录'), { status: 401 }); };
  await f.click('生成连接密钥'); assert.equal(unauthorized, 1); assert.equal(f.key(), undefined);
  assert(JSON.stringify(f.renderer.toJSON()).includes('请重新登录'));
});

test('revocation lists site and legacy scopes and removes only the chosen secret', async t => {
  const b = backend();
  b.records.push({ id: 'legacy', kind: 'control', scope: 'topic', topicId: 'old-topic', label: '旧设备', expiresAt: new Date(Date.now() + 86400000).toISOString(), revokedAt: null });
  const f = await fixture(t, b); await f.name('共享电脑'); await f.click('生成连接密钥');
  assert(JSON.stringify(f.renderer.toJSON()).includes('old-topic'));
  await act(async () => { f.renderer.root.find(node => node.type === 'button' && node.props['aria-label'] === '撤销授权 共享电脑').props.onClick(); await settle(); });
  assert.deepEqual(f.revoked, [[undefined, 'site-A-1']]); assert.equal(f.key(), undefined);
  assert.equal(b.records[0].revokedAt, null); assert(f.confirms[0].includes('所有电脑及其展示授权'));
});

test('old initial grant response cannot clear a newly minted key', async t => {
  const b = backend(); const list = b.client.grants; let finish, first = true;
  b.client.grants = () => { if (!first) return list(); first = false; return new Promise(resolve => { finish = () => resolve({ items: [] }); }); };
  const f = await fixture(t, b); await f.name('Fresh'); await f.click('生成连接密钥'); const key = f.key(); assert(key);
  await act(async () => { finish(); await settle(); }); assert.equal(f.key(), key);
});

test('focus and visibility synchronize grants while hidden pages do not refresh', async t => {
  const b = backend(); let calls = 0; const list = b.client.grants;
  b.client.grants = async () => { calls++; return list(); };
  const f = await fixture(t, b); const initial = calls;
  document.visibilityState = 'hidden'; await f.event('focus'); assert.equal(calls, initial);
  document.visibilityState = 'visible'; await f.event('visibilitychange'); assert.equal(calls, initial + 1);
  await f.event('focus'); assert.equal(calls, initial + 2);
});

test('legacy pairing remains restricted to the selected topic', async t => {
  const f = await fixture(t); await f.update({ topicId: 'topic-B', userCode: 'PAIR-1234' });
  const legacy = f.renderer.root.findAllByType('details').find(node => node.findByType('summary').children.join('') === '旧版设备配对');
  assert.equal(legacy.props.open, true);
  assert.equal(legacy.findByType('input').props.value, 'PAIR-1234');
  await f.click('批准设备配对'); assert.deepEqual(f.paired, [['PAIR-1234', 'topic-B']]); assert.equal(f.created.length, 0);
});
