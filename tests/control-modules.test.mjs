import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { WindChimeLiveControlPanel, WINDCHIME_LIVE_MODULES } from '../dist/broadcast/ControlPanel.js';
import { WindChimeLiveCard } from '../dist/broadcast/Display.js';
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

test('blind-box solo live mode stays spoiler-free, respects randomDrawEnabled, supports one-click approve+show and reject', async t => {
  const draft1 = { nickname: '盲盒一号', text: '绝不能提前剧透给观众的正文一', assets: [], linkUrl: null };
  const draft2 = { nickname: '盲盒二号', text: '绝不能提前剧透给观众的正文二', assets: [], linkUrl: null };
  let server = {
    topicId: 'topic', revision: 1, epoch: 'epoch', appearance, receivers: 1,
    current: null, queue: [],
    messages: [
      { id: 'b1', status: 'pending', draft: structuredClone(draft1), source: structuredClone(draft1), draftRevision: 1, snapshotId: null, createdAt: '2026-09-13T00:00:00Z', isRead: false, isFavorited: false, isFlagged: false },
      { id: 'b2', status: 'pending', draft: structuredClone(draft2), source: structuredClone(draft2), draftRevision: 1, snapshotId: null, createdAt: '2026-09-13T00:01:00Z', isRead: false, isFavorited: false, isFlagged: false },
    ],
  };
  const commands = [];
  const client = {
    state: async () => structuredClone(server),
    grants: async () => ({ items: [] }),
    action: async command => {
      commands.push(structuredClone(command));
      server = structuredClone(server);
      server.revision++;
      const msg = server.messages.find(m => m.id === command.messageId);
      if (command.action === 'draft' && msg) { msg.draft = structuredClone(command.draft); msg.draftRevision++; }
      if (command.action === 'approve' && msg) { msg.status = 'approved'; msg.snapshotId = 'snap-' + msg.id; if (!server.queue.includes(msg.id)) server.queue.push(msg.id); }
      if (command.action === 'show' && msg) { server.current = { messageId: msg.id, snapshotId: msg.snapshotId }; }
      if (command.action === 'reject' && msg) { msg.status = 'rejected'; }
      return structuredClone(server);
    },
  };
  let renderer;
  const render = extra => React.createElement(WindChimeLiveControlPanel, {
    client, topicId: 'topic', defaultStudioMode: 'blindbox', randomDrawEnabled: false,
    onScrollDisplay: () => {}, ...extra,
  });
  await act(async () => { renderer = create(render()); });
  t.after(() => act(async () => renderer.unmount()));

  // Standby: zero spoilers, random button hidden when randomDrawEnabled is false
  const initialJson = JSON.stringify(renderer.toJSON());
  assert(!initialJson.includes('绝不能提前剧透'), 'standby does not leak pending letter text');
  assert(!initialJson.includes('随机拆一封'), 'random draw button hidden by default');

  // Enable randomDrawEnabled -> button appears
  await act(async () => { renderer.update(render({ randomDrawEnabled: true })); });
  assert(JSON.stringify(renderer.toJSON()).includes('随机拆一封'));

  // Draw first letter privately -> text visible only in unbox card, zero server commands sent yet
  const btn = text => renderer.root.findAllByType('button').find(item => item.children.join('') === text);
  await act(async () => { await btn('拆下一封 ✉').props.onClick(); });
  assert.equal(commands.length, 0, 'drawing privately sends no broadcast command');
  assert(JSON.stringify(renderer.toJSON()).includes('绝不能提前剧透给观众的正文一'));

  // Click quick-redact, edit text, then 1-click 保存并直接上屏 -> draft + approve + show
  await act(async () => { btn('✎ 快速打码 / 编辑').props.onClick(); });
  const textarea = renderer.root.findByType('textarea');
  await act(async () => { textarea.props.onChange({ target: { value: '打码后的安全正文一' } }); });
  await act(async () => { await btn('✓ 保存并直接上屏').props.onClick(); await new Promise(r => setImmediate(r)); });
  assert.deepEqual(commands.map(c => c.action), ['draft', 'approve', 'show']);
  assert.equal(commands[0].draft.text, '打码后的安全正文一');
  assert.equal(commands[1].expectedDraftRevision, 2);
  assert.equal(commands[2].messageId, 'b1');

  // Draw second letter and reject -> never shown
  const drawNext = renderer.root.findAllByType('button').find(item => item.children.join('').startsWith('拆下一封'));
  await act(async () => { await drawNext.props.onClick(); });
  await act(async () => { await btn('✕ 跳过拒绝').props.onClick(); await new Promise(r => setImmediate(r)); });
  assert.equal(commands.at(-1).action, 'reject');
  assert.equal(commands.at(-1).messageId, 'b2');
});

test('1.0.0 blindbox compact tile, reading stats, pending count callback, and local overlay card rendering work cleanly', async t => {
  assert(WINDCHIME_LIVE_MODULES.some(m => m.id === 'blindbox'), 'blindbox module is registered');
  let reportedPending = -1;
  const f = await fixture(t, {
    module: 'blindbox',
    onPendingCountChange: count => { reportedPending = count; },
    onScrollDisplay: () => {},
  });
  assert.equal(reportedPending, 1);
  const drawBtn = f.button('拆下一封 ✉');
  assert(drawBtn, 'compact blindbox tile renders draw button');
  await act(async () => { await drawBtn.props.onClick(); });
  const json = JSON.stringify(f.renderer.toJSON());
  assert(json.includes('预计读'), 'unbox card shows estimated reading time');
  assert(!json.includes('待播队列（'), 'compact blindbox tile omits bulky full history drawer');

  let card;
  await act(async () => {
    card = create(React.createElement(WindChimeLiveCard, {
      snapshot: { id: 's1', messageId: 'm1', nickname: '小铃', text: '测试本地装饰', linkUrl: null, assets: [] },
      appearance,
      assetUrls: {},
      localOverlay: {
        enabled: true,
        badgeUrl: 'data:image/png;base64,iVBORw0KGgo=',
        badgePosition: 'bottom-right',
        badgeSize: 72,
        badgeOpacity: 85,
        watermarkText: '@风铃频道',
        backgroundUrl: 'data:image/png;base64,iVBORw0KGgo=',
        backgroundOpacity: 30,
      },
    }));
  });
  t.after(() => act(async () => card.unmount()));
  const cardJson = JSON.stringify(card.toJSON());
  assert(cardJson.includes('@风铃频道'));
  assert(cardJson.includes('wc-display-local-bg'));
  assert(cardJson.includes('wc-display-local-badge'));
});
