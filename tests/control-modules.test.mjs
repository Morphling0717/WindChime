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

test('transport tile renders on-air teleprompter only when a letter is live and dispatches scroll commands', async t => {
  const scrollCommands = [];
  let server = state();
  const client = {
    state: async () => structuredClone(server),
    grants: async () => ({ items: [] }),
    action: async () => structuredClone(server),
  };
  let renderer;
  const scrollState = { ratio: 0.25, offset: 50, maximum: 200, viewportHeight: 200, contentHeight: 400, paused: false, autoEnabled: true, phase: 'scrolling' };
  const render = extra => React.createElement(WindChimeLiveControlPanel, {
    client, topicId: 'topic', module: 'transport', scrollState,
    onScrollDisplay: command => { scrollCommands.push(command); }, ...extra,
  });
  await act(async () => { renderer = create(render()); });
  t.after(() => act(async () => renderer.unmount()));
  assert(!JSON.stringify(renderer.toJSON()).includes('完整的合成测试信件'), 'blank output never reveals unshown letter text');

  server = { ...server, current: { messageId: 'approved', snapshotId: 'snapshot' } };
  await act(async () => { renderer.update(render({ key: 'live' })); });
  assert(JSON.stringify(renderer.toJSON()).includes('完整的合成测试信件'), 'on-air letter appears in teleprompter');
  const btn = text => renderer.root.findAllByType('button').find(item => item.children.join('') === text);
  await act(async () => btn('↓ 下翻').props.onClick());
  await act(async () => btn('⏸ 暂停滚动').props.onClick());
  await act(async () => btn('⤒ 回顶部').props.onClick());
  assert.deepEqual(scrollCommands, [
    { type: 'step', delta: 0.45 },
    { type: 'togglePause' },
    { type: 'top' },
  ]);
});

test('review editor supports one-click save-and-approve while keeping explicit approve disabled when dirty', async t => {
  let server = state();
  const commands = [];
  const client = {
    state: async () => structuredClone(server),
    grants: async () => ({ items: [] }),
    action: async command => {
      commands.push(structuredClone(command));
      server = structuredClone(server);
      server.revision++;
      const msg = server.messages.find(m => m.id === command.messageId);
      if (command.action === 'draft' && msg) {
        msg.draft = structuredClone(command.draft);
        msg.draftRevision++;
      }
      if (command.action === 'approve' && msg) {
        msg.status = 'approved';
        msg.snapshotId = 'snap-new';
        if (!server.queue.includes(msg.id)) server.queue.push(msg.id);
      }
      return structuredClone(server);
    },
  };
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(WindChimeLiveControlPanel, { client, topicId: 'topic', module: 'review', selectedMessageId: 'pending' }));
  });
  t.after(() => act(async () => renderer.unmount()));
  const btn = text => renderer.root.findAllByType('button').find(item => item.children.join('') === text);
  assert.equal(btn('保存并批准'), undefined, 'hidden while clean');
  const textarea = renderer.root.findByType('textarea');
  await act(async () => textarea.props.onChange({ target: { value: '一步保存并批准的正文' } }));
  assert.equal(btn('批准进入待播').props.disabled, true);
  assert.equal(btn('保存并批准').props.disabled, false);
  await act(async () => { await btn('保存并批准').props.onClick(); await new Promise(r => setImmediate(r)); });
  assert.deepEqual(commands.map(c => c.action), ['draft', 'approve']);
  assert.equal(commands[0].expectedDraftRevision, 1);
  assert.equal(commands[1].expectedDraftRevision, 2);
  assert.equal(commands[1].expectedRevision, 2);
});

test('queue and transport expose previous letter, played status, display guide, and inbox search/badges', async t => {
  const draft1 = { nickname: '阿风', text: '第一封带图来信', assets: [{ id: 'img-1', caption: '配图说明' }], linkUrl: null };
  const draft2 = { nickname: '小铃', text: '第二封纯文字来信', assets: [], linkUrl: null };
  let server = {
    topicId: 'topic', revision: 1, epoch: 'epoch', appearance, receivers: 0,
    current: null,
    queue: ['m1', 'm2'],
    messages: [
      { id: 'm1', status: 'approved', draft: structuredClone(draft1), source: structuredClone(draft1), draftRevision: 1, snapshotId: 's1', createdAt: '2026-09-13T00:00:00Z', isRead: false, isFavorited: false, isFlagged: false },
      { id: 'm2', status: 'approved', draft: structuredClone(draft2), source: structuredClone(draft2), draftRevision: 1, snapshotId: 's2', createdAt: '2026-09-13T00:01:00Z', isRead: false, isFavorited: false, isFlagged: false },
    ],
  };
  const commands = [];
  let opened = 0;
  const client = {
    state: async () => structuredClone(server),
    grants: async () => ({ items: [] }),
    action: async command => { commands.push(command); server = { ...server, revision: server.revision + 1 }; return structuredClone(server); },
  };
  let renderer;
  const render = extra => React.createElement(WindChimeLiveControlPanel, {
    client, topicId: 'topic', onOpenDisplay: async () => { opened++; }, ...extra,
  });
  await act(async () => { renderer = create(render()); });
  t.after(() => act(async () => renderer.unmount()));

  // Display guide visible when receivers === 0
  assert(JSON.stringify(renderer.toJSON()).includes('尚未打开展示窗口'));
  // Image badge visible on inbox row
  assert(JSON.stringify(renderer.toJSON()).includes('图 1'));
  // Search filters inbox rows
  const search = renderer.root.findAllByType('input').find(node => node.props['aria-label'] === '搜索审核来信');
  await act(async () => search.props.onChange({ target: { value: '小铃' } }));
  assert.equal(renderer.root.findAll(node => node.type === 'button' && node.props.className === 'wc-mail').length, 1);
  await act(async () => search.props.onChange({ target: { value: '' } }));

  // Previous button dispatches show for previous item in queue when second letter is live
  server = { ...server, receivers: 1, current: { messageId: 'm2', snapshotId: 's2' } };
  await act(async () => { renderer.update(render({ key: 'live' })); });
  const prevBtn = renderer.root.findAllByType('button').find(item => item.children.join('') === '← 上一封');
  assert.equal(prevBtn.props.disabled, false);
  await act(async () => { await prevBtn.props.onClick(); });
  assert.equal(commands.at(-1).action, 'show');
  assert.equal(commands.at(-1).messageId, 'm1');
});
