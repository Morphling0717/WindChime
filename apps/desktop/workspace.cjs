// This file contains presentation preferences only. It never stores credentials
// or restores windows/letters automatically after an application restart.
const TILE_MODULES = Object.freeze({ inbox: '来信列表', review: '信件审阅', queue: '待播列表', transport: '播出控制', appearance: '展示外观' });
const HIDE_SHORTCUT = 'CommandOrControl+Shift+H';
function normalizeNextShortcut(value) {
  if (typeof value !== 'string' || value.length > 80) throw new Error('请输入有效的下一封快捷键');
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
function restoreWorkspace(value) {
  const restored = { version: 1, nextShortcut: '', tiles: {} };
  if (!value || value.version !== 1) return restored;
  try { restored.nextShortcut = normalizeNextShortcut(value.nextShortcut ?? ''); } catch {}
  for (const module of Object.keys(TILE_MODULES)) {
    const item = value.tiles?.[module]; if (!item || typeof item !== 'object') continue;
    const bounds = item.bounds;
    restored.tiles[module] = { pinned: item.pinned !== false };
    if (bounds && ['x','y','width','height'].every(key => Number.isFinite(bounds[key])) && bounds.width >= 320 && bounds.width <= 3000 && bounds.height >= 240 && bounds.height <= 2400 && Math.abs(bounds.x) < 20000 && Math.abs(bounds.y) < 20000) restored.tiles[module].bounds = Object.fromEntries(['x','y','width','height'].map(key => [key, Math.round(bounds[key])]));
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
module.exports = { TILE_MODULES, HIDE_SHORTCUT, normalizeNextShortcut, restoreWorkspace, fitTileBounds };
