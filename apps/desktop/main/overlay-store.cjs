// Pure DI local-only display decoration store (badge image, background overlay, watermark text).
// Images are validated by magic bytes, safely decoded & re-encoded as PNG via Electron nativeImage,
// and stored strictly in userData/local-overlay/ without ever touching website servers.

const DEFAULT_OVERLAY_CONFIG = Object.freeze({
  enabled: false,
  badgePosition: 'top-right',
  badgeSize: 64,
  badgeOpacity: 90,
  watermarkText: '',
  backgroundOpacity: 35,
});

const VALID_POSITIONS = new Set(['top-right', 'top-left', 'bottom-right', 'bottom-left']);

function isValidImageBuffer(bytes) {
  if (!bytes || bytes.length < 12) return false;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const isWebp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return isPng || isJpeg || isWebp;
}

function resolveOverlayConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: src.enabled === true,
    badgePosition: VALID_POSITIONS.has(src.badgePosition) ? src.badgePosition : DEFAULT_OVERLAY_CONFIG.badgePosition,
    badgeSize: Number.isFinite(src.badgeSize) ? Math.round(Math.min(128, Math.max(32, src.badgeSize))) : DEFAULT_OVERLAY_CONFIG.badgeSize,
    badgeOpacity: Number.isFinite(src.badgeOpacity) ? Math.round(Math.min(100, Math.max(10, src.badgeOpacity))) : DEFAULT_OVERLAY_CONFIG.badgeOpacity,
    watermarkText: typeof src.watermarkText === 'string'
      ? src.watermarkText.replace(/[\r\n\t\x00-\x1f]/g, '').trim().slice(0, 40)
      : '',
    backgroundOpacity: Number.isFinite(src.backgroundOpacity)
      ? Math.round(Math.min(80, Math.max(0, src.backgroundOpacity)))
      : DEFAULT_OVERLAY_CONFIG.backgroundOpacity,
  };
}

function createOverlayStore({ fs, path, nativeImage, dialog, getDir, getConfig, saveConfig, onChanged }) {
  const cache = { badge: null, background: null };
  let version = 0;
  let loaded = false;

  function slotPath(slot) {
    return path.join(getDir(), slot === 'badge' ? 'badge.png' : 'background.png');
  }

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    for (const slot of ['badge', 'background']) {
      try {
        const bytes = await fs.readFile(slotPath(slot));
        if (bytes && bytes.length > 0 && bytes.length <= 5 * 1024 * 1024 && isValidImageBuffer(bytes)) {
          cache[slot] = bytes;
        }
      } catch {}
    }
  }

  function snapshot() {
    const config = resolveOverlayConfig(getConfig());
    return {
      ...config,
      hasBadge: !!cache.badge,
      hasBackground: !!cache.background,
      badgeUrl: cache.badge ? `data:image/png;base64,${cache.badge.toString('base64')}` : null,
      backgroundUrl: cache.background ? `data:image/png;base64,${cache.background.toString('base64')}` : null,
      version,
    };
  }

  // Lightweight payload for OBS Browser Source (uses HTTP URLs instead of huge inline base64 over SSE)
  function obsSnapshot(basePath) {
    const config = resolveOverlayConfig(getConfig());
    return {
      ...config,
      badgeUrl: cache.badge ? `${basePath}/overlay/badge?v=${version}` : null,
      backgroundUrl: cache.background ? `${basePath}/overlay/background?v=${version}` : null,
      version,
    };
  }

  async function read() {
    await ensureLoaded();
    return snapshot();
  }

  async function update(patch) {
    await ensureLoaded();
    if (!patch || typeof patch !== 'object') throw new Error('无效本地装饰设置');
    const next = resolveOverlayConfig({ ...resolveOverlayConfig(getConfig()), ...patch });
    await saveConfig(next);
    version++;
    const state = snapshot();
    onChanged?.(state);
    return state;
  }

  async function saveImageBytes(slot, rawBytes) {
    if (slot !== 'badge' && slot !== 'background') throw new Error('无效装饰位置');
    if (!rawBytes || rawBytes.length > 5 * 1024 * 1024 || !isValidImageBuffer(rawBytes)) {
      throw new Error('请选择不超过 5 MiB 的静态 PNG、JPEG 或 WebP 图片');
    }
    const image = nativeImage.createFromBuffer(rawBytes);
    const size = image.getSize();
    if (image.isEmpty() || size.width <= 0 || size.height <= 0 || size.width * size.height > 16000000) {
      throw new Error('图片无法解码或像素过大');
    }
    const maxEdge = slot === 'badge' ? 256 : 1920;
    const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
    const png = image.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'best',
    }).toPNG();
    await fs.mkdir(getDir(), { recursive: true });
    await fs.writeFile(slotPath(slot), png);
    cache[slot] = png;
    version++;
    const state = snapshot();
    onChanged?.(state);
    return state;
  }

  async function pick(slot, parentWindow) {
    await ensureLoaded();
    if (slot !== 'badge' && slot !== 'background') throw new Error('无效装饰位置');
    const choice = await dialog.showOpenDialog(parentWindow, {
      title: slot === 'badge' ? '选择展示窗角标图片' : '选择展示窗背景叠图',
      properties: ['openFile'],
      filters: [{ name: '静态图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const stat = await fs.stat(choice.filePaths[0]);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('图片不能超过 5 MiB');
    const bytes = await fs.readFile(choice.filePaths[0]);
    return saveImageBytes(slot, bytes);
  }

  async function clear(slot) {
    await ensureLoaded();
    if (slot !== 'badge' && slot !== 'background') throw new Error('无效装饰位置');
    cache[slot] = null;
    try { await fs.unlink(slotPath(slot)); } catch {}
    version++;
    const state = snapshot();
    onChanged?.(state);
    return state;
  }

  function getBytes(slot) {
    if (slot !== 'badge' && slot !== 'background') return null;
    return cache[slot];
  }

  return {
    read,
    get: () => snapshot(),
    getObsPayload: obsSnapshot,
    update,
    pick,
    saveImageBytes,
    clear,
    getBytes,
  };
}

module.exports = { DEFAULT_OVERLAY_CONFIG, resolveOverlayConfig, isValidImageBuffer, createOverlayStore };
