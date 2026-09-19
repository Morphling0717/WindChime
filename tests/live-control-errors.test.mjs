import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { useWindChimeLiveControl } from '../dist/react/live.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(t) {
  const originalInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
  const timers = new Set(), commands = [];
  let current, renderer, readError = null, actionError = null, revision = 1;
  globalThis.setInterval = callback => { timers.add(callback); return callback; };
  globalThis.clearInterval = callback => timers.delete(callback);
  const state = topicId => ({ topicId, epoch: 'epoch', revision, messages: [], queue: [], current: null, appearance: {}, receivers: 1 });
  const client = {
    state: async topicId => { if (readError) throw readError; return state(topicId); },
    action: async command => { commands.push(command); if (actionError) throw actionError; revision++; return state(command.topicId); },
  };
  function Harness({ topicId = 'A', source = client }) { current = useWindChimeLiveControl(source, topicId); return null; }
  t.after(async () => {
    await act(async () => renderer?.unmount());
    globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClearInterval;
  });
  await act(async () => { renderer = create(React.createElement(Harness)); });
  return {
    get current() { return current; }, commands, client,
    failRead(error) { readError = error; }, failAction(error) { actionError = error; },
    tick: async () => act(async () => { await Promise.all([...timers].map(callback => callback())); }),
    run: async command => { let result; await act(async () => { result = await current.act(command); }); return result; },
    switch: async props => act(async () => renderer.update(React.createElement(Harness, props))),
  };
}

for (const action of ['show', 'next']) test(`${action} conflict stays visible through successful polls until a new manual command`, async t => {
  const f = await fixture(t), command = { action, ...(action === 'show' ? { messageId: 'reviewed-letter' } : {}) };
  f.failAction(Object.assign(new Error('展示连接已更新，请重新手动上屏'), { status: 409 }));
  assert.equal(await f.run(command), false);
  assert.equal(f.current.error, '展示连接已更新，请重新手动上屏');
  for (let i = 0; i < 4; i++) await f.tick();
  assert.equal(f.current.connected, true);
  assert.equal(f.current.error, '展示连接已更新，请重新手动上屏');
  assert.equal(f.current.operationError, '展示连接已更新，请重新手动上屏');
  assert.equal(f.commands.length, 1, 'polls only refresh state, never replay show or next');
  f.failAction(null);
  assert.equal(await f.run(command), true);
  assert.equal(f.commands.length, 2);
  assert.equal(f.current.operationError, null);
  assert.equal(f.current.error, null);
});

test('connection errors clear on recovery without losing an existing action conflict', async t => {
  const f = await fixture(t);
  f.failRead(new Error('连接中断'));
  await f.tick();
  assert.equal(f.current.connected, false);
  assert.equal(f.current.connectionError, '连接中断');
  assert.equal(f.current.error, '连接中断');
  f.failRead(null); await f.tick();
  assert.equal(f.current.connected, true);
  assert.equal(f.current.connectionError, null);
  assert.equal(f.current.error, null);
  f.failAction(new Error('操作版本冲突'));
  await f.run({ action: 'show', messageId: 'reviewed-letter' });
  f.failRead(new Error('暂时断线')); await f.tick();
  assert.equal(f.current.connectionError, '暂时断线');
  assert.equal(f.current.operationError, '操作版本冲突');
  assert.equal(f.current.error, '操作版本冲突');
  f.failRead(null); await f.tick();
  assert.equal(f.current.connectionError, null);
  assert.equal(f.current.error, '操作版本冲突');
  assert.equal(f.commands.length, 1);
});

test('changing the topic or client clears errors from the old scope', async t => {
  const f = await fixture(t);
  f.failAction(new Error('A的操作冲突'));
  await f.run({ action: 'next' });
  f.failRead(new Error('A的连接错误')); await f.tick();
  f.failRead(null);
  await f.switch({ topicId: 'B' });
  assert.equal(f.current.state.topicId, 'B');
  assert.equal(f.current.error, null);
  assert.equal(f.current.operationError, null);
  assert.equal(f.current.connectionError, null);
  f.failAction(new Error('旧网站的操作冲突'));
  await f.run({ action: 'next' });
  await f.switch({ topicId: 'B', source: { ...f.client } });
  assert.equal(f.current.error, null);
  assert.equal(f.commands.length, 2, 'scope changes do not replay either action');
});
