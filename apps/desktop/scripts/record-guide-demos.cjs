// Automated 2K HiDPI interactive tutorial demo recorder for WindChime Desktop.
// Launches the real Electron control window at deviceScaleFactor=2 (2400x1520 physical),
// drives real UI clicks with a smooth vector mouse cursor + click ripples + step callouts,
// and encodes 8 razor-sharp 1920x1216 VP9 WebM loops + WebP posters into src/guide-media/.

const { app, BrowserWindow, dialog, shell, globalShortcut } = require('electron');
app.commandLine.appendSwitch('force-device-scale-factor', '2');

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const { encodeWindChimeConnectionKey } = require('../build/connection-key.cjs');

const OUTPUT_DIR = path.resolve(__dirname, '../src/guide-media');
const WIN_W = 1280;
const WIN_H = 800;
const FPS = 18;
const TOKEN = 'wc_ctl_' + Buffer.alloc(32, 9).toString('base64url');
const EXPIRES_AT = '2099-01-01T00:00:00Z';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const makeTopic = (id, title, isDefault = false, extra = {}) => ({
  id,
  title,
  slug: id,
  description: extra.description || '欢迎给主播投递匿名问题与日常分享',
  note: extra.note || '常规直播话题',
  isDefault,
  isEnabled: true,
  startsAt: null,
  endsAt: null,
  archivedAt: null,
  sortOrder: extra.sortOrder ?? 0,
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-26T12:00:00Z',
  state: isDefault ? 'default' : 'active',
  isEnabledNow: true,
  unreadCount: extra.unreadCount ?? 2,
  flaggedCount: 0,
});

const INITIAL_TOPICS = () => [
  makeTopic('daily', '日常杂谈提问箱', true, { sortOrder: 0, unreadCount: 3 }),
  makeTopic('late-night', '周五深夜电台回', false, { sortOrder: 1, unreadCount: 1, description: '深夜树洞、歌单点播与睡前聊天' }),
  makeTopic('birthday', '生日限定来信盒', false, { sortOrder: 2, unreadCount: 0, description: '给主播的生日祝福与回忆卡片' }),
];

const INITIAL_MESSAGES = () => [
  {
    id: 'm1',
    topicId: 'daily',
    nickname: '小橘猫',
    text: '主播晚上好！今天画的新衣服超级可爱～顺便附上我家橘猫晒太阳的照片，右下角好像不小心露了点水印，上屏前可以帮我涂一下码吗？谢谢主播！',
    isRead: false,
    isFavorited: true,
    isFlagged: false,
    senderLabel: '访客 #108',
    createdAt: new Date(Date.now() - 18 * 60000).toISOString(),
    assets: [{ id: 'asset-cat', caption: '晒太阳的小橘猫（角落含模拟隐私 ID）' }],
  },
  {
    id: 'm2',
    topicId: 'daily',
    nickname: '银河邮差',
    text: '刚入坑的新粉报到！之前看录播切片笑到停不下来，请问平时开播前都是怎么挑选读信顺序的呀？另外这封信稍微长一点，希望主播慢慢读完～\n\n非常喜欢现在通透的液态玻璃控制台，也祝直播间越来越热闹！',
    isRead: false,
    isFavorited: false,
    isFlagged: false,
    senderLabel: '访客 #109',
    createdAt: new Date(Date.now() - 12 * 60000).toISOString(),
    assets: [],
  },
  {
    id: 'm3',
    topicId: 'daily',
    nickname: '抹茶糯米糍',
    text: '祝主播每天开开心心，越来越多人喜欢你的直播间！周五深夜电台我一定准时来蹲点，已经把提问箱海报转给群友一起投稿啦～',
    isRead: true,
    isFavorited: true,
    isFlagged: false,
    senderLabel: '访客 #092',
    createdAt: new Date(Date.now() - 45 * 60000).toISOString(),
    assets: [],
  },
  {
    id: 'm4',
    topicId: 'daily',
    nickname: '夏夜听风',
    text: '主播上次翻唱好好听！下次歌回能不能点一首轻松治愈一点的曲子？辛苦啦！',
    isRead: false,
    isFavorited: false,
    isFlagged: false,
    senderLabel: '访客 #114',
    createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
    assets: [],
  },
];

let topics = INITIAL_TOPICS();
let messages = INITIAL_MESSAGES();
let approved = new Set(['m3']);
let rejected = new Set();
let currentOnAir = null;
let revision = 1;
let activation = 1;
let assetStore = new Map();
let appearance = {
  fontFamily: 'system-ui',
  fontSize: 30,
  textColor: '#ffffff',
  backgroundColor: '#172334e8',
  transparent: true,
  layout: 'stack',
  theme: 'pure',
  accentColor: '#36d6de',
  borderWidth: 0,
  lineHeight: 1.65,
  letterSpacing: 0,
  maxWidth: 1000,
  viewportHeight: 620,
  imageLayout: 'column',
  imageHeightPercent: 45,
  animation: 'fade',
  borderRadius: 24,
  padding: 32,
};
let origin = '';

function resetMockState() {
  topics = INITIAL_TOPICS();
  messages = INITIAL_MESSAGES();
  approved = new Set(['m3']);
  rejected = new Set();
  currentOnAir = null;
  revision += 1;
  appearance = {
    ...appearance,
    theme: 'pure',
    layout: 'stack',
    accentColor: '#36d6de',
  };
}

function buildLiveState(topicId) {
  const list = messages.filter(m => m.topicId === topicId).map(m => {
    const assets = (m.draftAssets || m.assets || []).map(a => ({ id: a.id, caption: a.caption || '' }));
    const srcAssets = (m.assets || []).map(a => ({ id: a.id, caption: a.caption || '' }));
    const status = rejected.has(m.id) ? 'rejected' : approved.has(m.id) ? 'approved' : 'pending';
    return {
      ...m,
      source: { text: m.text, nickname: m.nickname, linkUrl: null, assets: srcAssets },
      draft: { text: m.draftText ?? m.text, nickname: m.draftNickname ?? m.nickname, linkUrl: null, assets },
      draftRevision: m.draftRevision ?? 1,
      status,
      snapshotId: status === 'approved' ? `snap-${m.id}-${m.draftRevision ?? 1}` : null,
    };
  });
  return {
    topicId,
    revision,
    epoch: 'demo-epoch',
    messages: list,
    queue: [...approved].filter(id => list.some(m => m.id === id)),
    current: currentOnAir,
    appearance,
    receivers: 1,
  };
}

function extractMultipartFile(buffer, contentType) {
  const match = /boundary=([^;\s]+)/i.exec(contentType || '');
  if (!match) return null;
  const boundary = Buffer.from(`--${match[1].replace(/^"|"$/g, '')}`);
  let pos = buffer.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length + 2;
    const next = buffer.indexOf(boundary, start);
    if (next === -1) break;
    const part = buffer.subarray(start, next - 2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      if (/name="file"/i.test(headers)) {
        return part.subarray(headerEnd + 4);
      }
    }
    pos = next;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname.replace('/api/mail/live', '');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const rawBody = Buffer.concat(chunks);
    const json = (val, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(val));
    };

    if (route === '/capabilities') {
      return json({
        protocolVersion: 1,
        siteId: 'uliuli-demo',
        features: {
          connectionKeys: true,
          siteControl: true,
          mailManagement: true,
          keywordFilterToggle: true,
          displayThemes: true,
        },
      });
    }

    if (route.startsWith('/control/assets/') || route.startsWith('/display/assets/')) {
      const assetId = route.split('/').pop();
      const entry = assetStore.get(assetId);
      if (!entry) return json({ error: 'Asset not found' }, 404);
      res.writeHead(200, { 'content-type': entry.mimeType, 'cache-control': 'no-store' });
      res.end(entry.bytes);
      return;
    }

    if (route === '/control/upload' && req.method === 'POST') {
      const fileBytes = extractMultipartFile(rawBody, req.headers['content-type']);
      const id = `asset-redacted-${Date.now()}`;
      assetStore.set(id, { bytes: fileBytes && fileBytes.length > 64 ? fileBytes : assetStore.get('asset-cat').bytes, mimeType: 'image/png' });
      return json({ id, mimeType: 'image/png', width: 720, height: 460 });
    }

    const body = rawBody.length && (req.headers['content-type'] || '').includes('json')
      ? JSON.parse(rawBody.toString('utf8'))
      : {};

    if (route === '/control/identity') {
      return json({
        siteId: 'uliuli-demo',
        scope: 'site',
        topicId: null,
        topicTitle: null,
        grantId: 'grant-demo',
        label: 'UliUli 提问箱',
        expiresAt: EXPIRES_AT,
      });
    }
    if (route === '/control/topics' && req.method === 'GET') return json({ items: topics });
    if (route.startsWith('/control/topics/')) {
      const id = route.split('/')[3];
      const found = topics.find(t => t.id === id);
      if (!found) return json({ error: 'Topic not found' }, 404);
      return json(found);
    }
    if (route === '/control/settings') return json({ enabled: true, blockedTermsEnabled: true });
    if (route === '/control/blocked-terms') return json({ terms: ['广告链接', '刷屏关键词'] });
    if (route === '/control/blocklist') return json([]);
    if (route === '/control/grants') return json({ items: [] });
    if (route === '/control/share') {
      const tid = url.searchParams.get('topicId') || 'daily';
      const t = topics.find(x => x.id === tid) || topics[0];
      return json({
        siteName: 'UliUli 提问箱',
        origin: 'https://uliuli.cn',
        topicId: tid,
        topicTitle: t.title,
        submissionUrl: `https://uliuli.cn/m/${tid}`,
        posterDefaults: {
          title: '来给我寄一封风铃信吧',
          subtitle: '匿名提问 · 直播间翻牌 · 日常碎碎念',
          signature: 'uliuli.cn · 直播提问箱',
          gradientStart: '#49b8c6',
          gradientEnd: '#7689e8',
          textColor: '#ffffff',
        },
      });
    }

    const topicId = url.searchParams.get('topicId') || body.topicId || 'daily';
    if (route === '/control/state') return json(buildLiveState(topicId));
    if (route === '/control/message') {
      const msg = messages.find(m => m.id === body.messageId);
      if (msg) {
        if (body.text !== undefined) msg.draftText = body.text;
        if (body.nickname !== undefined) msg.draftNickname = body.nickname;
        if (Array.isArray(body.assets)) msg.draftAssets = body.assets;
        msg.draftRevision = (msg.draftRevision ?? 1) + 1;
      }
      revision += 1;
      return json(buildLiveState(topicId));
    }
    if (route === '/control/action') {
      const act = body.action;
      if (act === 'approve' && body.messageId) {
        rejected.delete(body.messageId);
        approved.add(body.messageId);
      } else if (act === 'reject' && body.messageId) {
        approved.delete(body.messageId);
        rejected.add(body.messageId);
      } else if (act === 'revoke' && body.messageId) {
        approved.delete(body.messageId);
        if (currentOnAir?.messageId === body.messageId) currentOnAir = null;
      } else if (act === 'show' && body.messageId) {
        approved.add(body.messageId);
        const msg = messages.find(m => m.id === body.messageId);
        activation += 1;
        currentOnAir = {
          messageId: body.messageId,
          snapshotId: `snap-${body.messageId}-${msg?.draftRevision ?? 1}`,
          activation,
        };
      } else if (act === 'hide' || act === 'end') {
        currentOnAir = null;
      } else if (act === 'appearance' && body.appearance) {
        Object.assign(appearance, body.appearance);
      }
      revision += 1;
      return json(buildLiveState(topicId));
    }
    if (route === '/control/messages') {
      let items = messages.filter(m => m.topicId === topicId);
      const counts = {
        all: items.length,
        unread: items.filter(m => !m.isRead).length,
        favorited: items.filter(m => m.isFavorited).length,
        flagged: 0,
      };
      const filter = url.searchParams.get('filter');
      if (filter === 'unread') items = items.filter(m => !m.isRead);
      if (filter === 'favorited') items = items.filter(m => m.isFavorited);
      return json({ items, counts, blockedTermsEnabled: true });
    }
    if (route === '/control/messages/batch') {
      if (body.action === 'read') {
        messages.filter(m => body.ids.includes(m.id)).forEach(m => { m.isRead = true; });
      }
      return json({ ok: true });
    }
    if (route.startsWith('/control/messages/')) {
      const id = route.split('/')[3];
      const item = messages.find(m => m.id === id);
      if (!item) return json({ error: 'Not found' }, 404);
      if (req.method === 'PATCH') Object.assign(item, body);
      return json(req.method === 'GET' ? item : { ok: true });
    }
    if (route === '/display/open') return json({ receiverId: 'demo-rx', epoch: 'demo-epoch', leaseMs: 5000 });
    if (route === '/display/frame') {
      const msg = currentOnAir ? messages.find(m => m.id === currentOnAir.messageId) : null;
      return json({
        receiverId: 'demo-rx',
        epoch: 'demo-epoch',
        leaseMs: 5000,
        revision,
        activation,
        appearance,
        snapshot: msg ? {
          id: currentOnAir.snapshotId,
          messageId: msg.id,
          nickname: msg.draftNickname ?? msg.nickname,
          text: msg.draftText ?? msg.text,
          linkUrl: null,
          assets: (msg.draftAssets || msg.assets || []),
        } : null,
      });
    }
    return json({ ok: true });
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

// High-DPI vector cursor + target focus ring + click ripple + step caption injected into DOM
const CURSOR_OVERLAY_JS = `(() => {
  if (document.getElementById('wc-demo-layer')) return;
  const style = document.createElement('style');
  style.id = 'wc-demo-style';
  style.textContent = \`
    #wc-demo-layer {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483640;
      overflow: hidden;
    }
    #wc-demo-ring {
      position: fixed;
      border-radius: 14px;
      border: 2.5px solid #22b8cf;
      box-shadow: 0 0 0 4px rgba(34, 184, 207, 0.24), 0 8px 24px rgba(20, 140, 165, 0.28);
      opacity: 0;
      transition: opacity 0.12s ease;
    }
    #wc-demo-ripple {
      position: fixed;
      width: 44px;
      height: 44px;
      margin-left: -22px;
      margin-top: -22px;
      border-radius: 50%;
      border: 3px solid #ff6b6b;
      background: radial-gradient(circle, rgba(255, 107, 107, 0.34), rgba(34, 184, 207, 0.08));
      opacity: 0;
      transform: scale(0.3);
    }
    #wc-demo-cursor {
      position: fixed;
      left: 0;
      top: 0;
      width: 34px;
      height: 34px;
      margin-left: -3px;
      margin-top: -2px;
      filter: drop-shadow(0 4px 8px rgba(10, 24, 38, 0.42));
      transform-origin: 3px 2px;
    }
    #wc-demo-caption {
      position: fixed;
      padding: 8px 14px;
      border-radius: 999px;
      background: linear-gradient(135deg, rgba(14, 30, 44, 0.92), rgba(22, 54, 72, 0.92));
      color: #f4fcff;
      border: 1.5px solid rgba(112, 224, 240, 0.55);
      box-shadow: 0 10px 26px rgba(8, 22, 34, 0.36);
      font-family: "Microsoft YaHei UI", system-ui, sans-serif;
      font-size: 13.5px;
      font-weight: 600;
      letter-spacing: 0.01em;
      white-space: nowrap;
      opacity: 0;
    }
  \`;
  document.head.appendChild(style);
  const layer = document.createElement('div');
  layer.id = 'wc-demo-layer';
  layer.innerHTML = \`
    <div id="wc-demo-ring"></div>
    <div id="wc-demo-ripple"></div>
    <div id="wc-demo-caption"></div>
    <svg id="wc-demo-cursor" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 3.5L25.5 16.5L16.2 18.4L20.4 27.6L16.8 29.2L12.6 20L6.6 25.4V3.5Z"
            fill="#142330" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/>
    </svg>
  \`;
  document.body.appendChild(layer);
  window.__wcDemo = {
    x: 600,
    y: 380,
    setPose({ x, y, press = 0, ripple = 0, ring = null, caption = '' }) {
      this.x = x;
      this.y = y;
      const cur = document.getElementById('wc-demo-cursor');
      const rip = document.getElementById('wc-demo-ripple');
      const rng = document.getElementById('wc-demo-ring');
      const cap = document.getElementById('wc-demo-caption');
      const s = press ? 0.84 : 1;
      cur.style.transform = \`translate(\${x}px, \${y}px) scale(\${s})\`;
      if (ripple > 0) {
        rip.style.left = x + 'px';
        rip.style.top = y + 'px';
        rip.style.opacity = String(Math.max(0, 1 - ripple));
        rip.style.transform = \`scale(\${0.35 + ripple * 1.45})\`;
      } else {
        rip.style.opacity = '0';
      }
      if (ring) {
        rng.style.left = (ring.x - 4) + 'px';
        rng.style.top = (ring.y - 4) + 'px';
        rng.style.width = (ring.width + 8) + 'px';
        rng.style.height = (ring.height + 8) + 'px';
        rng.style.opacity = '1';
      } else {
        rng.style.opacity = '0';
      }
      if (caption) {
        cap.textContent = caption;
        cap.style.opacity = '1';
        const cw = cap.offsetWidth || 200;
        const ch = cap.offsetHeight || 34;
        let cx = x + 26;
        let cy = y + 26;
        if (cx + cw + 16 > window.innerWidth) cx = Math.max(14, x - cw - 20);
        if (cy + ch + 16 > window.innerHeight) cy = Math.max(54, y - ch - 20);
        cap.style.left = cx + 'px';
        cap.style.top = cy + 'px';
      } else {
        cap.style.opacity = '0';
      }
    }
  };
  window.__wcDemo.setPose({ x: 600, y: 380 });
})()`;

function createRecorder(win) {
  let framesDir = '';
  let frameIndex = 0;
  let curX = 600;
  let curY = 380;
  let curRing = null;
  let curCaption = '';
  let heroFrameIndex = 1;

  const evalJs = code => win.webContents.executeJavaScript(code);
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  async function begin(name) {
    framesDir = await fs.mkdtemp(path.join(os.tmpdir(), `wc-demo-${name}-`));
    frameIndex = 0;
    heroFrameIndex = 1;
    curRing = null;
    curCaption = '';
    await evalJs(CURSOR_OVERLAY_JS);
    await setPose({ x: curX, y: curY, caption: '' });
  }

  async function setPose(opts) {
    curX = opts.x ?? curX;
    curY = opts.y ?? curY;
    if ('ring' in opts) curRing = opts.ring;
    if ('caption' in opts) curCaption = opts.caption;
    await evalJs(`window.__wcDemo?.setPose(${JSON.stringify({
      x: curX,
      y: curY,
      press: opts.press || 0,
      ripple: opts.ripple || 0,
      ring: curRing,
      caption: curCaption,
    })})`);
  }

  async function snap(count = 1) {
    for (let i = 0; i < count; i++) {
      frameIndex += 1;
      const img = await win.webContents.capturePage();
      const file = path.join(framesDir, `frame_${String(frameIndex).padStart(4, '0')}.png`);
      await fs.writeFile(file, img.toPNG());
    }
  }

  function markHero() {
    heroFrameIndex = Math.max(1, frameIndex);
  }

  async function findRect(finderJs) {
    const rect = await evalJs(`(() => {
      const el = (${finderJs})();
      if (!el) return null;
      let r = el.getBoundingClientRect();
      if (r.top < 64 || r.bottom > window.innerHeight - 28) {
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
        r = el.getBoundingClientRect();
      }
      return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    })()`);
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      throw new Error(`Element not found for finder: ${finderJs}`);
    }
    return rect;
  }

  async function moveToPoint(tx, ty, { caption = curCaption, ring = null, steps = 12 } = {}) {
    const sx = curX;
    const sy = curY;
    for (let i = 1; i <= steps; i++) {
      const p = ease(i / steps);
      await setPose({
        x: sx + (tx - sx) * p,
        y: sy + (ty - sy) * p,
        ring: i >= Math.floor(steps * 0.65) ? ring : null,
        caption,
      });
      await snap(1);
    }
  }

  async function clickTarget(finderJs, caption, { holdBefore = 4, holdAfter = 14, moveSteps = 12, markAsHero = false } = {}) {
    const rect = await findRect(finderJs);
    await pause(80);
    const settled = await findRect(finderJs);
    await moveToPoint(settled.cx, settled.cy, { caption, ring: settled, steps: moveSteps });
    await snap(holdBefore);
    if (markAsHero) markHero();
    // Press down + trigger real click + ripple animation
    await setPose({ x: settled.cx, y: settled.cy, press: 1, ripple: 0.08, ring: settled, caption });
    await snap(1);
    await evalJs(`(() => {
      const el = (${finderJs})();
      if (el) el.click();
    })()`);
    await pause(90);
    for (const rip of [0.35, 0.65, 0.92]) {
      await setPose({ x: settled.cx, y: settled.cy, press: 0, ripple: rip, ring: settled, caption });
      await snap(1);
    }
    await setPose({ x: settled.cx, y: settled.cy, press: 0, ripple: 0, ring: null, caption });
    await pause(120);
    await snap(holdAfter);
  }

  async function hoverTarget(finderJs, caption, { hold = 18, moveSteps = 12, markAsHero = false } = {}) {
    const rect = await findRect(finderJs);
    await pause(80);
    const settled = await findRect(finderJs);
    await moveToPoint(settled.cx, settled.cy, { caption, ring: settled, steps: moveSteps });
    if (markAsHero) markHero();
    await snap(hold);
  }

  async function finish(fileBase) {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const webmPath = path.join(OUTPUT_DIR, `${fileBase}.webm`);
    const posterPath = path.join(OUTPUT_DIR, `${fileBase}.webp`);
    const heroPng = path.join(framesDir, `frame_${String(heroFrameIndex).padStart(4, '0')}.png`);

    await execFileAsync('ffmpeg', [
      '-y',
      '-framerate', String(FPS),
      '-i', path.join(framesDir, 'frame_%04d.png'),
      '-vf', 'scale=1920:1200:flags=lanczos',
      '-c:v', 'libvpx-vp9',
      '-crf', '24',
      '-b:v', '0',
      '-pix_fmt', 'yuv420p',
      '-deadline', 'good',
      '-cpu-used', '4',
      '-row-mt', '1',
      '-an',
      webmPath,
    ]);

    await execFileAsync('ffmpeg', [
      '-y',
      '-i', heroPng,
      '-vf', 'scale=1920:1200:flags=lanczos',
      '-c:v', 'libwebp',
      '-quality', '90',
      posterPath,
    ]);

    const [webmStat, posterStat] = await Promise.all([fs.stat(webmPath), fs.stat(posterPath)]);
    console.log(`Recorded ${fileBase}: ${frameIndex} frames -> webm ${(webmStat.size / 1024).toFixed(1)} KB, poster ${(posterStat.size / 1024).toFixed(1)} KB`);
    await fs.rm(framesDir, { recursive: true, force: true });
  }

  return { begin, setPose, snap, markHero, findRect, moveToPoint, clickTarget, hoverTarget, finish, evalJs };
}

async function generateDemoImages(win) {
  // Generate crisp 2x illustration PNG (for m1 + redactor demo) and a cute Q-style badge PNG (for overlay demo)
  const { catBase64, badgeBase64 } = await win.webContents.executeJavaScript(`(() => {
    // 1. Cute stylized cat photo with a simulated private corner ID for redactor demonstration
    const c = document.createElement('canvas');
    c.width = 720; c.height = 460;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 720, 460);
    bg.addColorStop(0, '#fff4dc');
    bg.addColorStop(0.55, '#ffe1b8');
    bg.addColorStop(1, '#ffd0a6');
    g.fillStyle = bg; g.fillRect(0, 0, 720, 460);
    // Sunbeams
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.beginPath(); g.arc(140, 95, 76, 0, Math.PI * 2); g.fill();
    // Window sill
    g.fillStyle = '#f6e7d4'; g.fillRect(0, 340, 720, 120);
    // Cute sleeping orange cat body
    g.fillStyle = '#f2994a';
    g.beginPath(); g.ellipse(340, 300, 155, 92, 0, 0, Math.PI * 2); g.fill();
    // Stripes
    g.fillStyle = '#d9772c';
    for (let i = 0; i < 4; i++) {
      g.beginPath(); g.ellipse(275 + i * 42, 238, 12, 28, 0.18, 0, Math.PI * 2); g.fill();
    }
    // Cat head
    g.fillStyle = '#f7a85b';
    g.beginPath(); g.arc(215, 278, 68, 0, Math.PI * 2); g.fill();
    // Ears
    g.beginPath(); g.moveTo(160, 232); g.lineTo(175, 178); g.lineTo(208, 218); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(222, 218); g.lineTo(254, 178); g.lineTo(268, 232); g.closePath(); g.fill();
    // Happy closed eyes + blush
    g.strokeStyle = '#5c3317'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.arc(192, 276, 12, 0.2, Math.PI - 0.2); g.stroke();
    g.beginPath(); g.arc(236, 276, 12, 0.2, Math.PI - 0.2); g.stroke();
    g.fillStyle = 'rgba(255,112,130,0.45)';
    g.beginPath(); g.ellipse(174, 294, 12, 7, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(254, 294, 12, 7, 0, 0, Math.PI * 2); g.fill();
    // Caption text
    g.fillStyle = '#6e4526';
    g.font = 'bold 26px "Microsoft YaHei UI", sans-serif';
    g.fillText('午后晒太阳的小橘猫 ☀', 42, 62);
    // Simulated private ID tag in bottom-right corner (redactor target!)
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath(); g.roundRect(452, 368, 238, 64, 14); g.fill();
    g.strokeStyle = '#e85d5d'; g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#c92a2a';
    g.font = 'bold 22px "Microsoft YaHei UI", monospace';
    g.fillText('WX: secret_9527', 474, 408);
    const catBase64 = c.toDataURL('image/png').split(',')[1];

    // 2. Cute Q-style WindChime streamer corner badge
    const b = document.createElement('canvas');
    b.width = 160; b.height = 160;
    const bg2 = b.getContext('2d');
    const grad = bg2.createLinearGradient(0, 0, 160, 160);
    grad.addColorStop(0, '#4dd4de');
    grad.addColorStop(1, '#6885f0');
    bg2.fillStyle = grad;
    bg2.beginPath(); bg2.arc(80, 80, 72, 0, Math.PI * 2); bg2.fill();
    bg2.strokeStyle = '#ffffff'; bg2.lineWidth = 8; bg2.stroke();
    bg2.fillStyle = '#ffffff';
    bg2.beginPath(); bg2.arc(80, 74, 34, Math.PI, 0); bg2.lineTo(114, 92); bg2.lineTo(46, 92); bg2.closePath(); bg2.fill();
    bg2.fillRect(76, 94, 8, 32);
    bg2.fillStyle = '#ffe066';
    bg2.beginPath(); bg2.roundRect(66, 114, 28, 20, 6); bg2.fill();
    const badgeBase64 = b.toDataURL('image/png').split(',')[1];
    return { catBase64, badgeBase64 };
  })()`);

  return {
    catBytes: Buffer.from(catBase64, 'base64'),
    badgeBytes: Buffer.from(badgeBase64, 'base64'),
  };
}

async function waitFor(win, expr, label, timeout = 12000) {
  for (let i = 0; i < timeout / 100; i++) {
    try {
      if (await win.webContents.executeJavaScript(`Boolean(${expr})`)) return;
    } catch {}
    await pause(100);
  }
  throw new Error('Timed out waiting for: ' + label);
}

app.whenReady().then(async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-guide-rec-'));
  app.setPath('userData', userData);

  // Seed realistic play history for Chapter 08
  const streamStart = new Date(Date.now() - 36 * 60000).toISOString();
  await fs.writeFile(
    path.join(userData, 'play-history.v1.json'),
    JSON.stringify({
      version: 1,
      streamStartedAt: streamStart,
      entries: [
        {
          id: 'h1',
          snapshotId: 'snap-m3-1',
          messageId: 'm3',
          playedAt: new Date(Date.now() - 28 * 60000).toISOString(),
          dateKey: '2026-11-27',
          siteLabel: 'UliUli 提问箱',
          topicTitle: '日常杂谈提问箱',
          nickname: '抹茶糯米糍',
          textPreview: '祝主播每天开开心心，越来越多人喜欢你的直播间！',
        },
        {
          id: 'h2',
          snapshotId: 'snap-m2-1',
          messageId: 'm2',
          playedAt: new Date(Date.now() - 16 * 60000).toISOString(),
          dateKey: '2026-11-27',
          siteLabel: 'UliUli 提问箱',
          topicTitle: '日常杂谈提问箱',
          nickname: '银河邮差',
          textPreview: '刚入坑的新粉报到！请问平时开播前都是怎么挑选读信顺序的呀？',
        },
        {
          id: 'h3',
          snapshotId: 'snap-m1-1',
          messageId: 'm1',
          playedAt: new Date(Date.now() - 6 * 60000).toISOString(),
          dateKey: '2026-11-27',
          siteLabel: 'UliUli 提问箱',
          topicTitle: '日常杂谈提问箱',
          nickname: '小橘猫',
          textPreview: '主播晚上好！今天画的新衣服超级可爱～顺便附上我家橘猫晒太阳的照片',
        },
      ],
    }),
  );

  // Use clean minimalist lite surface + dedicated non-conflicting OBS port for spotless 2K recording
  await fs.writeFile(
    path.join(userData, 'workspace.v1.json'),
    JSON.stringify({
      version: 1,
      nextShortcut: '',
      tiles: {},
      uiSurface: 'lite',
      autoCheckUpdate: false,
      obsBridge: { port: 17499 },
    }),
  );

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  dialog.showMessageBox = async () => ({ response: 1 });
  dialog.showSaveDialog = async () => ({ canceled: true });
  shell.openExternal = async () => {};
  // Avoid colliding with the user's running WindChime global hotkeys during demo capture
  globalShortcut.register = () => true;
  globalShortcut.unregister = () => {};
  globalShortcut.unregisterAll = () => {};

  require('../main.cjs');

  let win;
  for (let i = 0; i < 100; i++) {
    win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    if (win) break;
    await pause(100);
  }
  win.setSize(WIN_W, WIN_H);
  win.center();

  await waitFor(win, `document.querySelector('input[type="password"]')`, 'connect input');

  // Generate sample images & import local overlay badge through real IPC
  const { catBytes, badgeBytes } = await generateDemoImages(win);
  assetStore.set('asset-cat', { bytes: catBytes, mimeType: 'image/png' });
  const badgeTmp = path.join(userData, 'demo-badge.png');
  await fs.writeFile(badgeTmp, badgeBytes);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [badgeTmp] });

  // Import synthetic site key via preload bridge & reload to populate connected state
  const key = encodeWindChimeConnectionKey({ origin, siteId: 'uliuli-demo', token: TOKEN });
  const importRes = await win.webContents.executeJavaScript(`window.windchimeDesktop.importKey(${JSON.stringify(key)})`);
  if (!importRes?.ok) throw new Error('importKey failed: ' + JSON.stringify(importRes));
  win.webContents.reload();
  await waitFor(win, `document.querySelector('.desktop-sidebar nav button:not(:disabled)')`, 'connected nav');
  await waitFor(win, `document.querySelector('#desktop-topic')?.value === 'daily'`, 'topic selected');
  await win.webContents.executeJavaScript(`window.windchimeDesktop.pickOverlayImage('badge')`);
  await win.webContents.executeJavaScript(`window.windchimeDesktop.setOverlay({ enabled: false, watermarkText: '@UliUli 提问箱' })`);
  await pause(600);

  const rec = createRecorder(win);

  const navBtn = label => `() => Array.from(document.querySelectorAll('.desktop-sidebar nav button')).find(b => b.textContent.includes(${JSON.stringify(label)}))`;
  const btnText = text => `() => Array.from(document.querySelectorAll('button')).find(b => !b.disabled && b.offsetParent !== null && b.textContent.includes(${JSON.stringify(text)}))`;
  const tabText = text => `() => Array.from(document.querySelectorAll('[role="tab"]')).find(b => b.textContent.includes(${JSON.stringify(text)}))`;

  const onlyList = (process.env.WINDCHIME_DEMO_ONLY || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const shouldRun = num => !onlyList.length || onlyList.includes(num);

  // =========================================================================
  // 01: 收件箱 vs 直播工作台
  // =========================================================================
  if (shouldRun('01')) {
  resetMockState();
  await rec.evalJs(`(${navBtn('收件箱')})()?.click()`);
  await waitFor(win, `document.querySelector('.management-filters')`, 'inbox ready');
  await pause(400);
  await rec.begin('01');
  await rec.snap(8);
  await rec.clickTarget(`() => Array.from(document.querySelectorAll('.management-filters button')).find(b => b.textContent.includes('未读'))`, '① 在收件箱筛选「未读」来信', { holdAfter: 12 });
  await rec.clickTarget(`() => document.querySelector('.management-list input[type="checkbox"]')`, '② 勾选想准备播出的来信', { holdAfter: 8 });
  await rec.clickTarget(btnText('批量批准待播'), '③ 批量加入待播队列（不会误播）', { holdAfter: 12, markAsHero: true });
  await rec.clickTarget(navBtn('直播工作台'), '④ 切到「直播工作台」准备上屏', { holdAfter: 20 });
  await rec.finish('01-workspace-overview');
  }

  // =========================================================================
  // 02: OBS 浏览器源接入与测试卡对位
  // =========================================================================
  if (shouldRun('02')) {
  resetMockState();
  await rec.evalJs(`(${navBtn('直播工作台')})()?.click()`);
  await waitFor(win, `document.querySelector('.desktop-workspace-bar')`, 'studio ready');
  await pause(400);
  await rec.begin('02');
  await rec.snap(8);
  await rec.clickTarget(btnText('OBS 浏览器源'), '① 点开 OBS 采集设置（已默认开启）', { holdAfter: 12 });
  await rec.clickTarget(`() => Array.from(document.querySelectorAll('.obs-guide-card button')).find(b => b.textContent.includes('复制链接'))`, '② 复制固定链接，贴到 OBS 浏览器源', { holdAfter: 12, markAsHero: true });
  await rec.clickTarget(`() => Array.from(document.querySelectorAll('.obs-guide-card button')).find(b => b.textContent.includes('发测试卡对位 OBS'))`, '③ 发测试卡在 OBS 里框选大小与位置', { holdAfter: 22 });
  await rec.finish('02-obs-setup');
  // Cleanup: close test card & OBS guide panel
  await win.webContents.executeJavaScript(`window.windchimeDesktop.setTestCard(false)`);
  await rec.evalJs(`document.querySelector('.obs-close-btn')?.click()`);
  await pause(300);
  }

  // =========================================================================
  // 03: 盲盒拆信、确认并上屏、一键隐藏
  // =========================================================================
  if (shouldRun('03')) {
  resetMockState();
  await rec.evalJs(`(${navBtn('收件箱')})()?.click()`);
  await pause(200);
  await rec.evalJs(`(${navBtn('直播工作台')})()?.click()`);
  await waitFor(win, `Array.from(document.querySelectorAll('button')).some(b => !b.disabled && b.textContent.includes('拆下一封'))`, 'studio standby 03');
  await pause(400);
  await rec.begin('03');
  await rec.snap(8);
  await rec.clickTarget(btnText('拆下一封'), '① 点击「拆下一封」仅在私屏预览', { holdAfter: 16 });
  await rec.clickTarget(btnText('确认并直接上屏'), '② 确认无雷后点击「确认并直接上屏」', { holdAfter: 18, markAsHero: true });
  await rec.clickTarget(`() => document.querySelector('.desktop-hide')`, '③ 随时点「一键隐藏」或按 Ctrl+Shift+H 清屏', { holdAfter: 20 });
  await rec.finish('03-blindbox-live');
  }

  // =========================================================================
  // 04: 附图局部打码（涂抹马赛克）
  // =========================================================================
  if (shouldRun('04')) {
  resetMockState();
  await rec.evalJs(`(${navBtn('收件箱')})()?.click()`);
  await pause(200);
  await rec.evalJs(`(${navBtn('直播工作台')})()?.click()`);
  await waitFor(win, `Array.from(document.querySelectorAll('button')).some(b => !b.disabled && b.textContent.includes('拆下一封'))`, 'studio standby 04');
  await pause(350);
  await rec.evalJs(`(${btnText('拆下一封')})()?.click()`);
  await waitFor(win, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('局部打码') || b.textContent.includes('私下查看原图'))`, 'blindbox card with asset');
  await pause(450);
  await rec.begin('04');
  await rec.snap(6);
  // Reveal blurred attachment first if masked
  const hasReveal = await rec.evalJs(`Boolean(Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('私下查看原图')))`);
  if (hasReveal) {
    await rec.clickTarget(`() => Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('私下查看原图'))`, '① 先在私屏点开查看模糊保护的附图', { holdAfter: 10 });
  }
  await rec.clickTarget(btnText('局部打码'), '② 点击「🖌 局部打码」打开马赛克画板', { holdAfter: 14 });
  await waitFor(win, `document.querySelector('.wc-redactor-canvas') && getComputedStyle(document.querySelector('.wc-redactor-canvas')).display !== 'none'`, 'redactor canvas ready');
  await pause(250);
  // Drag across bottom-right sensitive box on .wc-redactor-canvas
  const canvasRect = await rec.findRect(`() => document.querySelector('.wc-redactor-canvas')`);
  const startX = canvasRect.x + canvasRect.width * 0.64;
  const startY = canvasRect.y + canvasRect.height * 0.85;
  const endX = canvasRect.x + canvasRect.width * 0.94;
  const endY = canvasRect.y + canvasRect.height * 0.85;
  await rec.moveToPoint(startX, startY, { caption: '③ 按住鼠标在敏感信息上拖动涂抹马赛克', ring: null, steps: 10 });
  await rec.evalJs(`(() => {
    const cv = document.querySelector('.wc-redactor-canvas');
    cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: ${startX}, clientY: ${startY} }));
  })()`);
  for (let i = 1; i <= 14; i++) {
    const p = i / 14;
    const x = startX + (endX - startX) * p;
    const y = startY + Math.sin(p * Math.PI * 3) * 10;
    await rec.evalJs(`(() => {
      const cv = document.querySelector('.wc-redactor-canvas');
      cv.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, buttons: 1, clientX: ${x}, clientY: ${y} }));
    })()`);
    await rec.setPose({ x, y, press: 1, caption: '③ 按住鼠标在敏感信息上拖动涂抹马赛克' });
    await rec.snap(1);
    if (i === 10) rec.markHero();
  }
  await rec.evalJs(`(() => {
    const cv = document.querySelector('.wc-redactor-canvas');
    cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, buttons: 0, clientX: ${endX}, clientY: ${endY} }));
  })()`);
  await rec.setPose({ x: endX, y: endY, press: 0, caption: '③ 已涂抹马赛克保护，可继续补涂或撤销' });
  await rec.snap(8);
  await rec.clickTarget(btnText('完成打码并替换'), '④ 保存打码副本，不破坏网站原图', { holdAfter: 18 });
  await rec.finish('04-redactor-spotlight');
  }

  // =========================================================================
  // 05: 单屏悬浮小窗 & 全局热键 / 桌面偏好
  // =========================================================================
  if (shouldRun('05')) {
  resetMockState();
  await rec.evalJs(`(${navBtn('收件箱')})()?.click()`);
  await pause(200);
  await rec.evalJs(`(${navBtn('直播工作台')})()?.click()`);
  await pause(450);
  await rec.begin('05');
  await rec.snap(8);
  await rec.clickTarget(`() => document.querySelector('.wc-tile-more > summary')`, '① 展开「更多悬浮窗」，拉出置顶小窗', { holdAfter: 16, markAsHero: true });
  await rec.clickTarget(navBtn('设置与外观'), '② 进入「设置与外观」', { holdAfter: 8 });
  await rec.clickTarget(tabText('播控与热键'), '③ 切到「播控与热键」配置单屏神器', { holdAfter: 10 });
  await rec.clickTarget(`() => document.querySelector('input[aria-label="启用随机拆一封按钮"]')`, '④ 开启随机抽签与风铃提示音', { holdAfter: 10 });
  await rec.hoverTarget(`() => document.querySelector('input[aria-label="下一封热键"]')`, '⑤ 点击即可录制全局下一封 / 滚屏热键', { hold: 18 });
  await rec.finish('05-tiles-hotkeys');
  }

  // =========================================================================
  // 06: 展示卡片外观定制 & 本机角标水印
  // =========================================================================
  if (shouldRun('06')) {
  await rec.evalJs(`(${navBtn('设置与外观')})()?.click()`);
  await pause(250);
  await rec.evalJs(`(${tabText('展示外观')})()?.click()`);
  await waitFor(win, `document.querySelector('.wc-appearance-choice')`, 'appearance choices');
  await pause(450);
  await rec.begin('06');
  await rec.snap(8);
  await rec.clickTarget(`() => document.querySelectorAll('.wc-appearance-choice')[2]`, '① 切换观众端卡片主题预设并实时预览', { holdAfter: 14, markAsHero: true });
  await rec.clickTarget(`() => document.querySelector('input[aria-label="启用本机装饰叠层"]')`, '② 开启「本机装饰叠层」叠加专属角标与水印', { holdAfter: 12 });
  await rec.clickTarget(`() => Array.from(document.querySelectorAll('.overlay-pos-group button')).find(b => b.textContent.includes('右下角'))`, '③ 自由切换角标位置、大小与透明度', { holdAfter: 18 });
  await rec.finish('06-appearance-overlay');
  }

  // =========================================================================
  // 07: 话题管理 & 投稿分享（海报与二维码）
  // =========================================================================
  if (shouldRun('07')) {
  await rec.evalJs(`(${navBtn('话题管理')})()?.click()`);
  await waitFor(win, `document.querySelector('.management')`, 'topics view');
  await pause(450);
  await rec.begin('07');
  await rec.snap(8);
  await rec.hoverTarget(btnText('新建话题'), '① 可按活动新建独立提问箱话题互不串台', { hold: 14 });
  await rec.clickTarget(navBtn('投稿分享'), '② 进入「投稿分享」生成投稿海报与二维码', { holdAfter: 14 });
  await waitFor(win, `document.querySelector('canvas[aria-label="投稿海报预览"]')`, 'share poster canvas');
  await pause(300);
  await rec.clickTarget(btnText('复制地址'), '③ 一键复制粉丝投稿链接', { holdAfter: 10 });
  await rec.hoverTarget(btnText('保存海报 PNG'), '④ 导出与网页同步的 900px 高清海报与二维码', { hold: 20, markAsHero: true });
  await rec.finish('07-topics-share');
  }

  // =========================================================================
  // 08: 开播时间轴自动同步 & 一键复制 B站章节
  // =========================================================================
  if (shouldRun('08')) {
  await rec.evalJs(`(${navBtn('设置与外观')})()?.click()`);
  await pause(200);
  await rec.evalJs(`(${tabText('播控与热键')})()?.click()`);
  await pause(400);
  await rec.begin('08');
  await rec.hoverTarget(`() => document.querySelector('[aria-label="开播与录播时间轴自动同步"] button')`, '① 已默认监听 OBS 自动对齐开播时间轴', { hold: 14 });
  await rec.clickTarget(navBtn('直播工作台'), '② 下播后回到工作台导出本场复盘', { holdAfter: 12 });
  await rec.clickTarget(`() => document.querySelector('.wc-bb-history > summary')`, '③ 展开「本地播报复盘」查看精确时间戳', { holdAfter: 14 });
  await rec.clickTarget(btnText('复制 B站章节'), '④ 一键复制 B站视频分段章节粘贴到简介', { holdAfter: 20, markAsHero: true });
  await rec.finish('08-timeline-chapters');
  }

  server.close();
  await fs.rm(userData, { recursive: true, force: true }).catch(() => {});
  console.log('ALL 8 2K DEMOS RECORDED SUCCESSFULLY!');
  app.exit(0);
}).catch(err => {
  console.error('RECORD FAILED:', err);
  app.exit(1);
});
