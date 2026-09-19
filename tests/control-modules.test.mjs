import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { WindChimeLiveControlPanel } from '../dist/broadcast/ControlPanel.js';
import { DEFAULT_WINDCHIME_LIVE_APPEARANCE as appearance } from '../dist/core/live.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function state() {
  const draft = { nickname: '已审称呼', text: '完整的合成测试信件', assets: [], linkUrl: null };
  return { topicId: 'topic', revision: 1, epoch: 'epoch', appearance, receivers: 1, current: null, queue: ['approved'], messages: ['pending', 'approved'].map(id => ({ id, status: id, draft: structuredClone(draft), source: structuredClone(draft), draftRevision: 1, snapshotId: id === 'approved' ? 'snapshot' : null, createdAt: '2026-09-13T00:00:00Z', isRead: false, isFavorited: false, isFlagged: false })) };
}
async function fixture(t, props) {
  let server = state(), grants = 0;
  const commands = [];
  const client = { state: async () => structuredClone(server), grants: async () => { grants++; return { items: [] }; }, action: async command => { commands.push(command); server = { ...server, revision: server.revision + 1 }; return structuredClone(server); } };
  let renderer;
  const render = extra => React.createElement(WindChimeLiveControlPanel, { client, topicId: 'topic', ...props, ...extra });
  await act(async () => { renderer = create(render()); });
  t.after(() => act(async () => renderer.unmount()));
  return { renderer, commands, grants: () => grants, update: async extra => act(async () => renderer.update(render(extra))), button: text => renderer.root.findAllByType('button').find(item => item.children.join('') === text) };
}

test('transport tile mounts no inbox, editor or credential UI and uses normal explicit next/hide actions', async t => {
  const f = await fixture(t, { module: 'transport' });
  assert.equal(f.grants(), 0);
  assert.equal(f.renderer.root.findAllByType('textarea').length, 0);
  assert.equal(f.renderer.root.findAllByType('ol').length, 0);
  assert(!JSON.stringify(f.renderer.toJSON()).includes('完整的合成测试信件'));
  assert.equal(f.commands.length, 0);
  await act(async () => { await f.button('下一封 →').props.onClick(); });
  assert.equal(f.commands.at(-1).action, 'next');
  assert.equal(f.commands.at(-1).expectedRevision, 1);
  assert.equal(f.commands.at(-1).topicId, 'topic');
  assert(f.commands.at(-1).operationId);
  await act(async () => { await f.button('■ 一键隐藏').props.onClick(); });
  assert.equal(f.commands.at(-1).action, 'hide');
});

test('queue tile renders approved queue only and review navigation delegates to private host', async t => {
  const selections = [];
  const f = await fixture(t, { module: 'queue', onSelectMessage: async id => { selections.push(id); } });
  assert.equal(f.grants(), 0);
  assert.equal(f.renderer.root.findAllByType('li').length, 1);
  assert.equal(f.renderer.root.findAllByType('textarea').length, 0);
  await act(async () => { await f.button('审阅').props.onClick(); });
  assert.deepEqual(selections, ['approved']);
  assert.equal(f.commands.length, 0);
});

test('host-owned review selection remains unchanged when another window cannot discard the dirty draft', async t => {
  const f = await fixture(t, { module: 'inbox', selectedMessageId: 'pending', onSelectMessage: async () => { throw new Error('未保存稿已保留'); } });
  const rows = () => f.renderer.root.findAll(node => node.type === 'button' && node.props.className === 'wc-mail');
  await act(async () => { await rows()[1].props.onClick(); });
  assert.equal(rows()[0].props['aria-current'], true);
  assert.equal(rows()[1].props['aria-current'], false);
  assert(JSON.stringify(f.renderer.toJSON()).includes('未保存稿已保留'));
  assert.equal(f.commands.length, 0);
  await f.update({ selectedMessageId: 'approved' });
  assert.equal(rows()[1].props['aria-current'], true);
});

test('review tile receives selected message without requiring its own inbox and keeps approval explicit', async t => {
  const dirty = [];
  const f = await fixture(t, { module: 'review', selectedMessageId: 'pending', onDirtyChange: value => dirty.push(value) });
  assert.equal(f.grants(), 0);
  const textarea = f.renderer.root.findByType('textarea');
  assert.equal(textarea.props.value, '完整的合成测试信件');
  await act(async () => textarea.props.onChange({ target: { value: '私人未保存改稿' } }));
  assert.equal(dirty.at(-1), true);
  assert.equal(f.button('批准进入待播').props.disabled, true);
  assert.equal(f.commands.length, 0);
});

test('native emergency hide remains usable before a new tile has received any server state', async t => {
  let hidden = 0, renderer;
  const client = { state: async () => new Promise(() => {}) };
  await act(async () => { renderer = create(React.createElement(WindChimeLiveControlPanel, { client, topicId: 'topic', module: 'transport', onHideDisplay: async () => { hidden++; } })); });
  t.after(() => act(async () => renderer.unmount()));
  const hide = renderer.root.findAllByType('button').find(node => node.children.join('') === '■ 一键隐藏');
  assert.equal(hide.props.disabled, undefined);
  await act(async () => hide.props.onClick());
  assert.equal(hidden, 1);
});
