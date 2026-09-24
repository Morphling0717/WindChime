const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNextShortcut, restoreWorkspace, fitTileBounds } = require('../workspace.cjs');

test('next accelerator requires modifiers, normalizes aliases and protects the fixed hide shortcut', () => {
  assert.equal(normalizeNextShortcut('ctrl + alt + n'), 'CommandOrControl+Alt+N');
  assert.equal(normalizeNextShortcut('shift+F9'), 'Shift+F9');
  assert.equal(normalizeNextShortcut(''), '');
  for (const input of ['N', 'F8', 'ctrl', 'ctrl+shift+h', 'shift+ctrl+h', 'ctrl+ctrl+n', 'ctrl+unknown', 'ctrl+\n+N', null, {}, 'alt+']) assert.throws(() => normalizeNextShortcut(input));
});

test('workspace restores only bounded presentation preferences, never private data or active windows', () => {
  const restored = restoreWorkspace({ version: 1, nextShortcut: 'Ctrl+Alt+N', token: 'secret', selectedMessageId:'old', tiles: { inbox: { pinned:false,bounds:{x:10,y:20,width:400,height:500}, text:'private' }, review:{pinned:true,bounds:{x:Infinity,y:0,width:1,height:1}},evil:{url:'https://remote.invalid'}} });
  assert.deepEqual(restored, { version:1,nextShortcut:'CommandOrControl+Alt+N',tiles:{inbox:{pinned:false,bounds:{x:10,y:20,width:400,height:500}},review:{pinned:true}} });
  assert.deepEqual(restoreWorkspace({version:1,nextShortcut:'Ctrl+Shift+H'}),{version:1,nextShortcut:'',tiles:{}});
});

test('saved tile bounds stay reachable after a monitor is removed and preserve valid multi-monitor positions', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }, left = { x: -1920, y: 0, width: 1920, height: 1040 };
  const original = { x: -1800, y: 100, width: 500, height: 700 };
  assert.deepEqual(fitTileBounds(original, [primary, left]), original);
  assert.deepEqual(fitTileBounds(original, [primary]), { x: 0, y: 100, width: 500, height: 700 });
  assert.deepEqual(fitTileBounds({x:3000,y:2000,width:2000,height:2000},[primary]),{x:0,y:0,width:1920,height:1040});
  assert.deepEqual(fitTileBounds(original),{width:500,height:700});
});
