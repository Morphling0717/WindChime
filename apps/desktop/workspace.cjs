// This file contains presentation preferences only. It never stores credentials
// or restores windows/letters automatically after an application restart.
const TILE_MODULES = Object.freeze({
  blindbox: '盲盒拆信',
  inbox: '来信列表',
  review: '信件审阅',
  queue: '待播列表',
  transport: '播出控制',
  appearance: '展示外观',
});
const HIDE_SHORTCUT = 'CommandOrControl+Shift+H';
const VALID_STARTUP_VIEWS = new Set(['inbox', 'studio', 'last']);
const VALID_LAST_VIEWS = new Set(['inbox', 'studio', 'topics', 'share', 'settings']);
const VALID_BADGE_POSITIONS = new Set(['top-right', 'top-left', 'bottom-right', 'bottom-left']);
const VALID_UI_SURFACES = new Set(['liquid', 'standard', 'lite']);

function normalizeShortcut(value, label = '快捷键') {
  if (typeof value !== 'string' || value.length > 80) throw new Error(`请输入有效的${label}`);
  if (!value.trim()) return '';
  const tokens = value.trim().split('+').map(part => part.trim());
  const aliases = { ctrl: 'CommandOrControl', control: 'CommandOrControl', cmdorctrl: 'CommandOrControl', commandorcontrol: 'CommandOrControl', shift: 'Shift', alt: 'Alt', option: 'Alt', super: 'Super', meta: 'Super', command: 'Super', cmd: 'Super' };
  const key = tokens.pop();
  const modifiers = tokens.map(token => aliases[token.toLowerCase()]);
  if (!modifiers.length || modifiers.some(item => !item) || new Set(modifiers).size !== modifiers.length || !key || !/^(?:[A-Za-z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Escape|Left|Right|Up|Down|Home|End|PageUp|PageDown|Insert|Delete)$/i.test(key)) throw new Error('快捷键需要 Ctrl、Alt、Shift 或 Win 修饰键，再加一个字母、数字、方向键或功能键');
  const order = ['CommandOrControl', 'Alt', 'Shift', 'Super'];
  const named = ['Space','Enter','Tab','Escape','Left','Right','Up','Down','Home','End','PageUp','PageDown','Insert','Delete'];
  const normalizedKey = named.find(item => item.toLowerCase() === key.toLowerCase()) || key.toUpperCase();
  const result = [...order.filter(item => modifiers.includes(item)), normalizedKey].join('+');
  if (result === HIDE_SHORTCUT) throw new Error('Ctrl+Shift+H 已保留为一键隐藏，请选择其他快捷键');
  return result;
}

function normalizeNextShortcut(value) {
  return normalizeShortcut(value, '下一封快捷键');
}

function sanitizeObsBridge(value) {
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  if (value.enabled === false) out.enabled = false;
  if (Number.isInteger(value.port) && value.port >= 1024 && value.port <= 65535 && value.port !== 17420) {
    out.port = value.port;
  }
  if (typeof value.key === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value.key)) {
    out.key = value.key;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeLocalOverlay(value) {
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  if (value.enabled === true) out.enabled = true;
  if (typeof value.badgePosition === 'string' && VALID_BADGE_POSITIONS.has(value.badgePosition) && value.badgePosition !== 'top-right') {
    out.badgePosition = value.badgePosition;
  }
  if (Number.isFinite(value.badgeSize)) {
    const size = Math.round(Math.min(128, Math.max(32, value.badgeSize)));
    if (size !== 64) out.badgeSize = size;
  }
  if (Number.isFinite(value.badgeOpacity)) {
    const op = Math.round(Math.min(100, Math.max(10, value.badgeOpacity)));
    if (op !== 90) out.badgeOpacity = op;
  }
  if (typeof value.watermarkText === 'string') {
    const text = value.watermarkText.replace(/[\r\n\t\x00-\x1f]/g, '').trim().slice(0, 40);
    if (text) out.watermarkText = text;
  }
  if (Number.isFinite(value.backgroundOpacity)) {
    const bgOp = Math.round(Math.min(80, Math.max(0, value.backgroundOpacity)));
    if (bgOp !== 35) out.backgroundOpacity = bgOp;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeTimelineSync(value) {
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  if (value.obsLogEnabled === false) out.obsLogEnabled = false;
  if (value.obsWsEnabled === false) out.obsWsEnabled = false;
  if (Number.isInteger(value.obsWsPort) && value.obsWsPort >= 1024 && value.obsWsPort <= 65535 && value.obsWsPort !== 4455) {
    out.obsWsPort = value.obsWsPort;
  }
  if (typeof value.bilibiliRoomId === 'string') {
    const room = value.bilibiliRoomId.trim();
    if (/^\d{1,12}$/.test(room)) out.bilibiliRoomId = room;
  }
  if (value.preferTrack === 'record') out.preferTrack = 'record';
  return Object.keys(out).length ? out : undefined;
}

function restoreWorkspace(value) {
  const restored = { version: 1, nextShortcut: '', tiles: {} };
  if (!value || value.version !== 1) return restored;
  try { restored.nextShortcut = normalizeNextShortcut(value.nextShortcut ?? ''); } catch {}
  if (value.theme === 'dark') restored.theme = 'dark';
  if (value.randomDrawEnabled === true) restored.randomDrawEnabled = true;
  if (value.clearOnBlindDraw === true) restored.clearOnBlindDraw = true;
  if (value.chimeEnabled === true) restored.chimeEnabled = true;
  if (Number.isFinite(value.chimeVolume)) {
    const vol = Math.round(Math.min(100, Math.max(0, value.chimeVolume)));
    if (vol !== 70) restored.chimeVolume = vol;
  }
  if (typeof value.startupView === 'string' && VALID_STARTUP_VIEWS.has(value.startupView) && value.startupView !== 'last') {
    restored.startupView = value.startupView;
  }
  if (typeof value.lastView === 'string' && VALID_LAST_VIEWS.has(value.lastView)) {
    restored.lastView = value.lastView;
  }
  if (value.autoCheckUpdate === false) restored.autoCheckUpdate = false;
  if (value.displayMotion === false) restored.displayMotion = false;
  if (typeof value.uiSurface === 'string' && VALID_UI_SURFACES.has(value.uiSurface) && value.uiSurface !== 'liquid') {
    restored.uiSurface = value.uiSurface;
  }
  if (
    value.displayBounds &&
    typeof value.displayBounds === 'object' &&
    Number.isFinite(value.displayBounds.x) &&
    Number.isFinite(value.displayBounds.y) &&
    Math.abs(value.displayBounds.x) < 20000 &&
    Math.abs(value.displayBounds.y) < 20000
  ) {
    restored.displayBounds = { x: Math.round(value.displayBounds.x), y: Math.round(value.displayBounds.y) };
  }
  if (
    value.displaySize &&
    typeof value.displaySize === 'object' &&
    Number.isFinite(value.displaySize.width) &&
    Number.isFinite(value.displaySize.height) &&
    value.displaySize.width >= 280 &&
    value.displaySize.width <= 1920 &&
    value.displaySize.height >= 180 &&
    value.displaySize.height <= 1080
  ) {
    restored.displaySize = {
      width: Math.round(value.displaySize.width),
      height: Math.round(value.displaySize.height),
    };
  }
  const obsBridge = sanitizeObsBridge(value.obsBridge);
  if (obsBridge) restored.obsBridge = obsBridge;
  const localOverlay = sanitizeLocalOverlay(value.localOverlay);
  if (localOverlay) restored.localOverlay = localOverlay;
  const timelineSync = sanitizeTimelineSync(value.timelineSync);
  if (timelineSync) restored.timelineSync = timelineSync;
  const used = new Set([HIDE_SHORTCUT, restored.nextShortcut].filter(Boolean));
  for (const field of ['scrollUpShortcut', 'scrollDownShortcut', 'scrollPauseShortcut']) {
    try {
      const normalized = normalizeShortcut(value[field] ?? '');
      if (normalized && !used.has(normalized)) {
        used.add(normalized);
        restored[field] = normalized;
      }
    } catch {}
  }
  for (const module of Object.keys(TILE_MODULES)) {
    const item = value.tiles?.[module]; if (!item || typeof item !== 'object') continue;
    const bounds = item.bounds;
    restored.tiles[module] = { pinned: item.pinned !== false };
    if (bounds && ['x','y','width','height'].every(key => Number.isFinite(bounds[key])) && bounds.width >= 320 && bounds.width <= 3000 && bounds.height >= 240 && bounds.height <= 2400 && Math.abs(bounds.x) < 20000 && Math.abs(bounds.y) < 20000) {
      restored.tiles[module].bounds = Object.fromEntries(['x','y','width','height'].map(key => [key, Math.round(bounds[key])]));
    }
  }
  return restored;
}

function fitTileBounds(bounds, workAreas) {
  if (!bounds) return {};
  if (!Array.isArray(workAreas) || !workAreas.length) return { width: bounds.width, height: bounds.height };
  const area = workAreas.find(rect => bounds.x < rect.x + rect.width && bounds.x + bounds.width > rect.x && bounds.y < rect.y + rect.height && bounds.y + bounds.height > rect.y) || workAreas[0];
  const width = Math.max(340, Math.min(bounds.width, area.width)), height = Math.max(260, Math.min(bounds.height, area.height));
  return { width, height, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) };
}

function fitDisplayPosition(pos, size, workAreas) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return {};
  if (!Array.isArray(workAreas) || !workAreas.length) return { x: Math.round(pos.x), y: Math.round(pos.y) };
  const w = Math.max(280, Math.round(size?.width || 960));
  const h = Math.max(180, Math.round(size?.height || 640));
  const area = workAreas.find(rect => pos.x < rect.x + rect.width && pos.x + w > rect.x && pos.y < rect.y + rect.height && pos.y + h > rect.y) || workAreas[0];
  const maxX = Math.max(area.x, area.x + area.width - Math.min(w, area.width));
  const maxY = Math.max(area.y, area.y + area.height - Math.min(h, area.height));
  return {
    x: Math.round(Math.max(area.x, Math.min(pos.x, maxX))),
    y: Math.round(Math.max(area.y, Math.min(pos.y, maxY))),
  };
}

module.exports = {
  TILE_MODULES,
  HIDE_SHORTCUT,
  normalizeShortcut,
  normalizeNextShortcut,
  sanitizeObsBridge,
  sanitizeLocalOverlay,
  sanitizeTimelineSync,
  restoreWorkspace,
  fitTileBounds,
  fitDisplayPosition,
};
