const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { createObsBridge } = require('../main/obs-bridge.cjs');

function rawRequest(port, reqPath, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: reqPath, method, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('OBS loopback bridge enforces host/origin/key security, streams SSE events, proxies assets and accepts scroll metrics', async () => {
  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const clientCounts = [];
  const reportedMetrics = [];
  const fakeFs = {
    readFile: async file => file.endsWith('.html') ? '<html><meta name="windchime-obs-base" content="__WINDCHIME_OBS_BASE__"></html>' : 'console.log("obs");',
  };

  const bridge = createObsBridge({
    http,
    crypto,
    fs: fakeFs,
    path,
    buildDir: '/virtual',
    getInitialState: basePath => ({
      overlay: { enabled: true, badgeUrl: `${basePath}/overlay/badge?v=1`, badgePosition: 'top-right', badgeSize: 64, badgeOpacity: 90, watermarkText: 'Test', backgroundOpacity: 35 },
      frame: null,
      testCard: { active: true, appearance: null },
    }),
    fetchDisplayAsset: async assetId => assetId === 'img-1' ? { bytes: pngBytes, mimeType: 'image/png' } : null,
    getOverlayBytes: slot => slot === 'badge' ? pngBytes : null,
    getOverlayPayload: basePath => ({ enabled: true, badgeUrl: `${basePath}/overlay/badge?v=2` }),
    onScrollMetrics: m => reportedMetrics.push(m),
    onClientCountChange: c => clientCounts.push(c),
  });

  const { status } = await bridge.configure({ enabled: true, port: 0, key: 'validtestkey1234567890ab' });
  assert.equal(status.running, true);
  const port = status.port;
  assert.equal(status.url, `http://127.0.0.1:${port}/obs/validtestkey1234567890ab`);

  try {
    // Reject wrong key
    const wrongKey = await rawRequest(port, '/obs/wrongkey12345678901234');
    assert.equal(wrongKey.status, 404);

    // Reject spoofed Host header & cross-origin Origin header
    const badHost = await rawRequest(port, '/obs/validtestkey1234567890ab', { headers: { host: 'evil.example.com' } });
    assert.equal(badHost.status, 403);
    const badOrigin = await rawRequest(port, '/obs/validtestkey1234567890ab', { headers: { origin: 'https://evil.example.com' } });
    assert.equal(badOrigin.status, 403);

    // Serve HTML with injected base path & CSP
    const htmlRes = await rawRequest(port, '/obs/validtestkey1234567890ab');
    assert.equal(htmlRes.status, 200);
    assert(htmlRes.body.toString('utf8').includes('/obs/validtestkey1234567890ab'));
    assert(htmlRes.headers['content-security-policy'].includes("default-src 'none'"));

    // Proxy approved asset & local overlay PNG
    const assetRes = await rawRequest(port, '/obs/validtestkey1234567890ab/assets/img-1?activation=1');
    assert.equal(assetRes.status, 200);
    assert.equal(assetRes.headers['content-type'], 'image/png');
    assert(assetRes.body.equals(pngBytes));

    const overlayRes = await rawRequest(port, '/obs/validtestkey1234567890ab/overlay/badge');
    assert.equal(overlayRes.status, 200);
    assert(overlayRes.body.equals(pngBytes));

    // Report scroll metrics
    const metricsRes = await rawRequest(port, '/obs/validtestkey1234567890ab/scroll-metrics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ratio: 0.4, phase: 'manual' }),
    });
    assert.equal(metricsRes.status, 204);
    assert.equal(reportedMetrics.length, 1);
    assert.equal(reportedMetrics[0].ratio, 0.4);

    // Connect SSE and receive initial overlay/test-card + live frame + emergency blank
    const sseData = await new Promise((resolve, reject) => {
      let buf = '';
      const req = http.get({ host: '127.0.0.1', port, path: '/obs/validtestkey1234567890ab/events' }, res => {
        res.on('data', chunk => {
          buf += chunk.toString('utf8');
          if (buf.includes('event: test-card') && !buf.includes('snap-obs-1')) {
            bridge.pushFrame({ snapshot: { id: 'snap-obs-1', text: 'hello obs' } });
          } else if (buf.includes('snap-obs-1') && !buf.includes('event: blank')) {
            bridge.pushBlank();
          } else if (buf.includes('event: blank')) {
            req.destroy();
            resolve(buf);
          }
        });
      });
      req.on('error', err => { if (err.code !== 'ECONNRESET') reject(err); });
      setTimeout(() => { req.destroy(); reject(new Error('SSE timeout: ' + buf)); }, 4000);
    });
    assert(sseData.includes('event: overlay'));
    assert(sseData.includes('event: test-card'));
    assert(sseData.includes('event: frame'));
    assert(sseData.includes('snap-obs-1'));
    assert(sseData.includes('event: blank'));
    assert(clientCounts.includes(1));
  } finally {
    await bridge.stop();
  }
});
