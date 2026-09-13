// Real disposable localhost adapters and an isolated Electron process.
// Simulates a silent network outage only for this actor's display requests.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const outputDirectory = path.resolve(__dirname, '../out/lease-smoke');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function localOrigin(value) {
  const url = new URL(value);
  assert(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert(url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password);
  return url.origin;
}
async function launcher() {
  assert(process.env.WINDCHIME_SMOKE_ALLOW_WRITES === '1' && process.env.WINDCHIME_SMOKE_PASSWORD, 'Explicit disposable fixture opt-in required');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'windchime-lease-smoke-'));
  const env = { ...process.env, WINDCHIME_LEASE_SMOKE_DIRECTORY: directory }; delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    let diagnostics = '';
    const child = require('node:child_process').spawn(require('electron'), [__filename], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    child.stdout.on('data', data => process.stdout.write(data));
    child.stderr.on('data', data => { diagnostics += data.toString(); process.stderr.write(data); });
    child.once('error', reject);
    child.once('close', async code => {
      try {
        const reportPath = path.join(outputDirectory, 'report.json');
        const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
        assert.equal(report.directory, directory, 'Final report belongs to this actor');
        report.gracefulExit = code === 0;
        report.unhandledRuntimeErrors = /UnhandledPromiseRejection|Uncaught|Object has been destroyed/.test(diagnostics);
        report.passed = report.passed && report.gracefulExit && !report.unhandledRuntimeErrors;
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        assert(report.passed, 'Lease actor or its shutdown failed'); resolve();
      } catch (error) { reject(error); }
    });
  });
}
async function actor() {
  const { app, BrowserWindow, net } = require('electron');
  const { encodeWindChimeConnectionKey } = require('../build/connection-key.cjs');
  const directory = process.env.WINDCHIME_LEASE_SMOKE_DIRECTORY;
  assert(directory && path.basename(directory).startsWith('windchime-lease-smoke-'));
  const origins = [localOrigin(process.env.WINDCHIME_SMOKE_ULIULI_ORIGIN), localOrigin(process.env.WINDCHIME_SMOKE_MIA_ORIGIN)];
  assert.notEqual(...origins);
  const allowed = new Set(origins), cookies = new Map(), observations = [], requests = [], fixtures = [];
  const password = process.env.WINDCHIME_SMOKE_PASSWORD;
  const originalFetch = globalThis.fetch.bind(globalThis), originalNetFetch = net.fetch.bind(net);
  let control, active, outage = false, armOutage = false, lastSuccessfulFrame = null, displayOpens = 0, stalledRequests = 0, stage = 'startup';
  const phase = value => { stage = value; console.log(JSON.stringify({ phase: value })); };
  let nativeHiddenAt = null, blankAt = null, measuring = false, topicPolls = 0;
  const title = 'WindChime Lease Test ' + randomUUID().slice(0, 8);
  const absolute = () => Date.now(), monotonic = () => performance.now();
  const display = () => BrowserWindow.getAllWindows().find(window => window.getTitle() === title);
  const blankExpression = "document.body.innerText === '' && !document.querySelector('[data-windchime-snapshot], img')";
  async function until(check, label, timeout = 15000) {
    const start = monotonic();
    while (monotonic() - start < timeout) { if (await Promise.race([Promise.resolve().then(check), pause(800).then(() => false)])) return; await pause(25); }
    throw Error('Timed out: ' + label);
  }
  async function isBlank() {
    const window = display();
    if (!window || window.isDestroyed()) return false;
    try { return await window.webContents.executeJavaScript(blankExpression); } catch { return false; }
  }
  async function shown(marker) {
    try { return !!(await display()?.webContents.executeJavaScript(`!!document.querySelector('[data-windchime-snapshot]') && document.body.innerText.includes(${JSON.stringify(marker)})`)); } catch { return false; }
  }
  async function invoke(method, ...args) {
    const result = await control.webContents.executeJavaScript(`window.windchimeDesktop[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
    assert(result.ok, `Desktop ${method}: ${result.code || result.error || 'failed'}`); return result.data;
  }
  function instrument(fetchImpl) {
    return async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      assert(allowed.has(url.origin) && url.pathname.startsWith('/api/mail/'), 'Lease actor only contacts its configured loopback mail APIs');
      requests.push({ origin: url.origin, path: url.pathname, method: options?.method || 'GET' });
      if (url.pathname === '/api/mail/live/control/topics') topicPolls++;
      const isDisplay = url.pathname.startsWith('/api/mail/live/display/');
      if (isDisplay && outage) {
        stalledRequests++;
        // A real stalled socket produces no response. Preserve cancellation so
        // the product's own request timeout and independent lease timer compete.
        return new Promise((_, reject) => {
          const abort = () => reject(options?.signal?.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener('abort', abort, { once: true });
        });
      }
      const requestStartedAt = monotonic(), requestStartedAtUnixMs = absolute();
      const response = await fetchImpl(input, options);
      if (response.ok && url.pathname === '/api/mail/live/display/open') displayOpens++;
      if (response.ok && url.pathname === '/api/mail/live/display/frame') {
        const frame = await response.clone().json();
        if (frame.snapshot?.messageId === active?.messageId) {
          lastSuccessfulFrame = { requestStartedAt, requestStartedAtUnixMs, responseAt: monotonic(), responseAtUnixMs: absolute(), leaseMs: frame.leaseMs, receiverId: frame.receiverId };
          if (armOutage) { outage = true; armOutage = false; }
        }
      }
      return response;
    };
  }
  // global fetch is the product path; instrument net.fetch as well to detect
  // any future Electron transport change without changing application code.
  globalThis.fetch = instrument(originalFetch); net.fetch = instrument(originalNetFetch);
  app.setPath('userData', path.join(directory, 'profile'));
  app.on('browser-window-created', (_, window) => {
    if (window.getTitle() !== 'WindChime Display') return;
    window.setTitle(title);
    window.webContents.on('page-title-updated', event => { event.preventDefault(); window.setTitle(title); });
    window.on('hide', () => { if (measuring && nativeHiddenAt === null) nativeHiddenAt = monotonic(); });
    window.webContents.on('did-finish-load', () => {
      if (!measuring) return;
      void window.webContents.executeJavaScript(blankExpression).then(blank => { if (blank && blankAt === null) blankAt = monotonic(); }).catch(() => {});
    });
  });
  async function api(fixture, relative, method = 'GET', body, fan = false) {
    // Fixture administration bypasses only our outage simulation, never auth.
      const response = await originalFetch(fixture.origin + relative, { method, redirect: 'error', signal: AbortSignal.timeout(10000), headers: { ...(fan ? { 'x-real-ip': `198.19.${Math.floor(Math.random() * 249) + 1}.${Math.floor(Math.random() * 249) + 1}` } : { cookie: cookies.get(fixture.origin) }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json(); assert(response.ok, `${method} ${relative}: ${response.status} ${value.code || ''}`); return value;
  }
  const state = f => api(f, '/api/mail/live/control/state?topicId=' + encodeURIComponent(f.topicId));
  async function command(f, action, extra = {}) {
    const before = await state(f), message = before.messages.find(item => item.id === f.messageId);
    return api(f, '/api/mail/live/control/action', 'POST', { topicId: f.topicId, action, messageId: f.messageId, expectedRevision: before.revision, expectedDraftRevision: message?.draftRevision, operationId: randomUUID(), ...extra });
  }
  async function run() {
    require('../main.cjs'); await app.whenReady();
    await until(() => { control = BrowserWindow.getAllWindows().find(window => window.getTitle().includes('私人控制台')); return !!control; }, 'private controller');
    await until(() => control.webContents.executeJavaScript('!!window.windchimeDesktop').catch(() => false), 'preload');
    for (const [index, origin] of origins.entries()) {
      phase(`preparing-${index}`);
      const response = await originalFetch(origin + (index === 0 ? '/api/mail/session' : '/api/auth/session'), { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password, ...(index ? { scope: 'mail' } : {}) }) });
      assert(response.ok, 'Disposable website login: ' + response.status);
      cookies.set(origin, response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '));
      const name = index ? 'Mia' : 'UliUli', runId = randomUUID().slice(0, 8), slug = `lease-${name.toLowerCase()}-${runId}`;
      const topic = await api({ origin }, '/api/mail/topics', 'POST', { title: `租期验收 ${name} ${runId}`, slug });
      const fixture = { name, origin, topicId: topic.id, slug, marker: `LEASE_REVIEWED_${runId}` };
      await api(fixture, '/api/mail/messages', 'POST', { topicSlug: slug, text: `PRIVATE_LEASE_${runId}`, nickname: '合成租期测试', senderFingerprint: randomUUID() }, true);
      fixture.messageId = (await state(fixture)).messages[0].id;
      fixtures.push(fixture); active = fixture;
      const capabilities = await api(fixture, '/api/mail/live/capabilities');
      const grant = await api(fixture, '/api/mail/live/control/grants', 'POST', { topicId: fixture.topicId, kind: 'control', label: `租期验收旧话题密钥 ${runId}` });
      fixture.grantId = grant.id;
      const key = encodeWindChimeConnectionKey({ origin, siteId: capabilities.siteId, token: grant.token });
      phase(`importing-${name}`);
      await invoke('importKey', key);
      control.webContents.reload();
      await until(() => control.webContents.executeJavaScript(`!!window.windchimeDesktop && document.body.innerText.includes(${JSON.stringify(topic.title)})`).catch(() => false), 'scoped topic UI');
      control.showInactive();
      phase(`opening-${name}`);
      const topicPollsBefore = topicPolls;
      const opensBefore = displayOpens; await invoke('openDisplay'); await until(() => displayOpens > opensBefore && isBlank(), 'initial output handshake is blank');
      await command(fixture, 'draft', { draft: { text: fixture.marker, nickname: '已审租期测试', linkUrl: null, assets: [] } });
      await command(fixture, 'approve'); await pause(700); assert(await isBlank(), 'Approval is not playback');
      await command(fixture, 'show'); await until(() => shown(fixture.marker), 'manually activated reviewed snapshot');
      phase(`stable-playback-${name}`);
      // Old scoped credentials must remain playing across multiple private UI
      // refreshes, without querying forbidden global settings and clearing output.
      const stableStartedAt = monotonic();
      while (monotonic() - stableStartedAt < 7100) { assert(await shown(fixture.marker), 'Old topic key output persists across refresh'); await pause(100); }
      const stableElapsedMs = Math.round(monotonic() - stableStartedAt);
      assert(topicPolls - topicPollsBefore >= 2, 'At least two real topic refreshes occurred');
      assert(!requests.some(request => request.origin === origin && request.path === '/api/mail/live/control/settings'), 'Old scoped credential never requests global settings');
      nativeHiddenAt = null; blankAt = null; measuring = true; armOutage = true;
      phase(`silent-outage-${name}`);
      const stalledBefore = stalledRequests;
      await until(() => outage && lastSuccessfulFrame?.leaseMs, 'arm silent outage after exact successful frame');
      const successful = { ...lastSuccessfulFrame };
      await until(async () => { if (await isBlank()) { blankAt ??= monotonic(); return true; } return false; }, 'confirmed new empty output document', 4000);
      assert(nativeHiddenAt !== null, 'Native window hidden on lease expiry');
      assert(stalledRequests > stalledBefore, 'A display HTTP request actually stalled without a response');
      const timing = {
        lastSuccessfulFrameRequestUnixMs: successful.requestStartedAtUnixMs,
        lastSuccessfulFrameResponseUnixMs: successful.responseAtUnixMs,
        advertisedLeaseMs: successful.leaseMs,
        responseToNativeHideMs: Math.round(nativeHiddenAt - successful.responseAt),
        responseToConfirmedBlankMs: Math.round(blankAt - successful.responseAt),
        dispatchToConfirmedBlankMs: Math.round(blankAt - successful.requestStartedAt),
        observationIntervalMs: 25,
      };
      assert(timing.responseToConfirmedBlankMs <= 3000, 'Silent disconnect clears within 3 seconds of last successful frame response');
      assert(timing.dispatchToConfirmedBlankMs <= 3000, 'Slow response cannot extend the 3 second request-based lease');
      measuring = false;
      await pause(600); assert(await isBlank(), 'Offline retries remain blank');
      const opensAtRestore = displayOpens; outage = false;
      phase(`restoring-${name}`);
      await until(() => displayOpens > opensAtRestore, 'restored transport establishes a new display receiver', 10000);
      const restoredAt = monotonic();
      while (monotonic() - restoredAt < 1500) { assert(await isBlank(), 'Network restoration must not replay the prior approved snapshot'); await pause(50); }
      await command(fixture, 'show'); await until(() => shown(fixture.marker), 'fresh manual show after network restoration');
      await invoke('hide'); await until(isBlank, 'final explicit hide');
      observations.push({ site: name, topicId: fixture.topicId, oldTopicScopePlaybackStableMs: stableElapsedMs, topicRefreshes: topicPolls - topicPollsBefore, forbiddenSettingsRequests: 0, stalledDisplayRequests: stalledRequests - stalledBefore, ...timing, restoredWithoutReplayObservedMs: 1500, manualShowAfterRestore: true });
      console.log(JSON.stringify({ phase: 'site-complete', ...observations.at(-1) }));
    }
    for (const fixture of fixtures) await api(fixture, '/api/mail/live/control/grants/' + fixture.grantId + '?topicId=' + fixture.topicId, 'DELETE');
    const report = { passed: true, testedAt: new Date().toISOString(), electron: process.versions.electron, node: process.versions.node, os: { platform: os.platform(), release: os.release(), arch: os.arch() }, directory, observations, method: 'Real loopback Next.js adapters; independent actor suspends only display HTTP responses after a known successful reviewed frame; AbortSignal retained; native hide and confirmed blank DOM observed in separate display window', checks: ['Fresh and approved output remains blank until manual show', 'Old topic credential output stays nonempty across multiple real three-second topic refreshes without forbidden settings request', 'Silent stalled transport clears within 3 seconds from both last response and its request dispatch', 'Restored connection is blank until a new manual show', 'Only temporary topic grants created by this test were revoked'], limitations: ['Measures the Electron native hide event and confirmed new blank document, not actual OBS or LiveHime capture frames'] };
    await fs.mkdir(outputDirectory, { recursive: true }); await fs.writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); app.quit();
  }
  const timeout = setTimeout(() => { console.error('Lease fixture exceeded overall timeout at ' + stage); app.exit(1); }, 120000);
  try { await run(); clearTimeout(timeout); }
  catch (error) {
    outage = false; armOutage = false; measuring = false;
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify({ passed: false, testedAt: new Date().toISOString(), directory, stage, observations, fixtures, error: error.stack }, null, 2));
    console.error(error.stack); app.exit(1);
  }
}
(process.versions.electron ? actor() : launcher()).catch(error => { console.error(error.stack); process.exitCode = 1; });
