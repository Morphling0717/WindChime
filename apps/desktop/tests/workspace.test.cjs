const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNextShortcut, restoreWorkspace, fitTileBounds, fitDisplayPosition } = require('../workspace.cjs');

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

test('workspace restores optional scroll shortcuts and drops duplicates or conflicts', () => {
  const restored = restoreWorkspace({
    version: 1,
    nextShortcut: 'Ctrl+Alt+N',
    scrollUpShortcut: 'Alt+Up',
    scrollDownShortcut: 'Alt+Down',
    scrollPauseShortcut: 'Alt+Space',
    tiles: {},
  });
  assert.equal(restored.scrollUpShortcut, 'Alt+Up');
  assert.equal(restored.scrollDownShortcut, 'Alt+Down');
  assert.equal(restored.scrollPauseShortcut, 'Alt+Space');
  const deduped = restoreWorkspace({
    version: 1,
    nextShortcut: 'Alt+Up',
    scrollUpShortcut: 'Alt+Up',
    scrollDownShortcut: 'Ctrl+Shift+H',
    scrollPauseShortcut: 'Alt+Down',
    tiles: {},
  });
  assert.equal(deduped.scrollUpShortcut, undefined);
  assert.equal(deduped.scrollDownShortcut, undefined);
  assert.equal(deduped.scrollPauseShortcut, 'Alt+Down');
});

test('workspace restores dark theme preference and omits default or invalid values', () => {
  assert.equal(restoreWorkspace({ version: 1, theme: 'dark', tiles: {} }).theme, 'dark');
  assert.equal(restoreWorkspace({ version: 1, theme: 'light', tiles: {} }).theme, undefined);
  assert.equal(restoreWorkspace({ version: 1, theme: 'neon', tiles: {} }).theme, undefined);
  assert.equal(restoreWorkspace({ version: 1, randomDrawEnabled: true, clearOnBlindDraw: true, tiles: {} }).randomDrawEnabled, true);
  assert.equal(restoreWorkspace({ version: 1, randomDrawEnabled: true, clearOnBlindDraw: true, tiles: {} }).clearOnBlindDraw, true);
  assert.equal(restoreWorkspace({ version: 1, randomDrawEnabled: false, clearOnBlindDraw: 'yes', tiles: {} }).randomDrawEnabled, undefined);
  assert.equal(restoreWorkspace({ version: 1, randomDrawEnabled: false, clearOnBlindDraw: 'yes', tiles: {} }).clearOnBlindDraw, undefined);
  assert.equal(restoreWorkspace({ version: 1, uiSurface: 'liquid', tiles: {} }).uiSurface, undefined);
  assert.equal(restoreWorkspace({ version: 1, uiSurface: 'standard', tiles: {} }).uiSurface, 'standard');
  assert.equal(restoreWorkspace({ version: 1, uiSurface: 'lite', tiles: {} }).uiSurface, 'lite');
  assert.equal(restoreWorkspace({ version: 1, uiSurface: 'crystal', tiles: {} }).uiSurface, undefined);
  assert.equal(restoreWorkspace({ version: 1, displayMotion: true, tiles: {} }).displayMotion, undefined);
  assert.equal(restoreWorkspace({ version: 1, displayMotion: false, tiles: {} }).displayMotion, false);
  assert.equal(restoreWorkspace({ version: 1, displayMotion: 'no', tiles: {} }).displayMotion, undefined);
  assert.equal(
    restoreWorkspace({ version: 1, timelineSync: { obsLogEnabled: true, obsWsEnabled: true, obsWsPort: 4455, bilibiliRoomId: '', preferTrack: 'stream' }, tiles: {} }).timelineSync,
    undefined,
  );
  assert.deepEqual(
    restoreWorkspace({ version: 1, timelineSync: { obsWsEnabled: false, obsWsPort: 4466, bilibiliRoomId: ' 223344 ', preferTrack: 'record', obsWsPassword: 'leaked' }, tiles: {} }).timelineSync,
    { obsWsEnabled: false, obsWsPort: 4466, bilibiliRoomId: '223344', preferTrack: 'record' },
  );
  assert.equal(
    restoreWorkspace({ version: 1, timelineSync: { bilibiliRoomId: 'not-a-room', obsWsPort: 80 }, tiles: {} }).timelineSync,
    undefined,
  );
});

test('workspace restores 1.0.0 display position, chime, startup view, obs bridge, local overlay, and blindbox tile safely', () => {
  const restored = restoreWorkspace({
    version: 1,
    chimeEnabled: true,
    chimeVolume: 45,
    startupView: 'studio',
    lastView: 'settings',
    autoCheckUpdate: false,
    displayBounds: { x: 120.4, y: 80.7 },
    obsBridge: { enabled: true, port: 18888, key: 'abcdefghijklmnop1234' },
    localOverlay: { enabled: true, badgePosition: 'bottom-left', badgeSize: 80, badgeOpacity: 75, watermarkText: '  @风铃主播\n  ', backgroundOpacity: 25 },
    tiles: { blindbox: { pinned: true, bounds: { x: 20, y: 30, width: 380, height: 560 } } },
  });
  assert.equal(restored.chimeEnabled, true);
  assert.equal(restored.chimeVolume, 45);
  assert.equal(restored.startupView, 'studio');
  assert.equal(restored.lastView, 'settings');
  assert.equal(restored.autoCheckUpdate, false);
  assert.deepEqual(restored.displayBounds, { x: 120, y: 81 });
  assert.deepEqual(restored.obsBridge, { port: 18888, key: 'abcdefghijklmnop1234' });
  assert.deepEqual(
    restoreWorkspace({ version: 1, obsBridge: { enabled: false, port: 17420, key: 'abcdefghijklmnop1234' }, tiles: {} }).obsBridge,
    { enabled: false, key: 'abcdefghijklmnop1234' },
  );
  assert.deepEqual(restored.localOverlay, { enabled: true, badgePosition: 'bottom-left', badgeSize: 80, badgeOpacity: 75, watermarkText: '@风铃主播', backgroundOpacity: 25 });
  assert.equal(restored.tiles.blindbox.bounds.width, 380);

  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(fitDisplayPosition({ x: 3000, y: 2000 }, { width: 960, height: 640 }, [primary]), { x: 960, y: 400 });
  assert.deepEqual(fitDisplayPosition({ x: 100, y: 120 }, { width: 960, height: 640 }, [primary]), { x: 100, y: 120 });
});
