const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  compareSemver,
  isSafeReleaseUrl,
  isSafeDownloadUrl,
  verifySignedManifest,
  createUpdater,
} = require('../main/updater.cjs');
const { signManifest } = require('../scripts/generate-update-manifest.cjs');

test('semver comparison handles releases and prereleases accurately', () => {
  assert.equal(compareSemver('1.1.0', '1.0.0'), 1);
  assert.equal(compareSemver('v1.1.0', '1.1.0'), 0);
  assert.equal(compareSemver('0.9.5', '1.0.0'), -1);
  assert.equal(compareSemver('1.0.0', '1.0.0-beta.1'), 1);
  assert.equal(compareSemver('1.0.1', '1.0.0'), 1);
});

test('updater verifies Ed25519 signed manifest, downloads with SHA-256 verification, and launches installer safely', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const installerBytes = Buffer.from('MZ-fake-windchime-installer-binary-payload-v1.2.0');
  const sha256 = crypto.createHash('sha256').update(installerBytes).digest('hex');
  const signed = signManifest({
    schema: 1,
    version: '1.2.0',
    title: '风铃 1.2.0 测试版',
    publishedAt: '2026-12-01T00:00:00Z',
    notes: '- 新增测试功能',
    releasePageUrl: 'https://github.com/Morphling0717/WindChime/releases/tag/v1.2.0',
    windows: {
      fileName: 'WindChime-Setup-1.2.0.exe',
      size: installerBytes.length,
      sha256,
      urls: ['https://windchime.uliuli.cn/updates/WindChime-Setup-1.2.0.exe'],
    },
  }, privateKey);

  // Tampered manifest is strictly rejected
  assert.throws(
    () => verifySignedManifest({ ...signed, version: '9.9.9' }, publicKey, crypto),
    /数字签名校验失败/,
  );
  // Untrusted host is strictly rejected
  assert.equal(isSafeDownloadUrl('https://evil.example.com/WindChime-Setup-1.2.0.exe'), false);
  assert.equal(isSafeDownloadUrl('https://windchime.uliuli.cn/updates/WindChime-Setup-1.2.0.exe'), true);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wc-updater-test-'));
  const spawned = [];
  const order = [];
  let quitRequested = 0;
  const states = [];
  try {
    const updater = createUpdater({
      currentVersion: '1.1.0',
      crypto,
      fs,
      path,
      publicKeyPem: publicKey,
      feedUrl: 'https://windchime.uliuli.cn/updates/latest.json',
      getUpdatesDir: () => tmpDir,
      shell: { openExternal: async () => {} },
      spawn: (cmd, args, opts) => { order.push('spawn'); spawned.push({ cmd, args, opts }); return { unref() {} }; },
      onStateChange: s => states.push(s.stage),
      onBeforeInstallPrepare: async () => { await new Promise(r => setTimeout(r, 15)); order.push('prepare'); },
      onBeforeInstallQuit: () => { order.push('quit'); quitRequested++; },
      fetch: async url => {
        if (url.endsWith('/latest.json')) return Response.json(signed);
        if (url.endsWith('.exe')) return new Response(installerBytes, { status: 200, headers: { 'content-length': String(installerBytes.length) } });
        throw new Error('unexpected url: ' + url);
      },
    });

    const info = await updater.check();
    assert.equal(info.hasUpdate, true);
    assert.equal(info.verified, true);
    assert.equal(info.canDownload, true);
    assert.equal(info.source, 'windchime-mirror');
    assert.equal(info.latestVersion, '1.2.0');

    const dl = await updater.download();
    assert.equal(dl.stage, 'ready');
    assert.equal(dl.percent, 100);
    assert(states.includes('downloading'));
    assert(states.includes('verifying'));
    assert(states.includes('ready'));

    assert.equal(await updater.install(), true);
    assert.equal(spawned.length, 1);
    assert(spawned[0].cmd.endsWith('WindChime-Setup-1.2.0.exe'));
    assert.equal(spawned[0].opts.cwd, tmpDir, 'installer must spawn with updates dir as cwd, never inherited install dir');
    assert.equal(quitRequested, 1);
    assert.deepEqual(order, ['prepare', 'spawn', 'quit'], 'must complete shutdown cleanup BEFORE spawning installer');

    // Stale installer cleanup removes <= currentVersion installers and .downloading files, preserving newer cached installers
    await fs.writeFile(path.join(tmpDir, 'WindChime-Setup-1.0.0.exe'), 'old');
    await fs.writeFile(path.join(tmpDir, 'WindChime-Setup-1.1.0.exe'), 'same');
    await fs.writeFile(path.join(tmpDir, 'WindChime-Setup-1.2.0.exe.downloading'), 'partial');
    const cleaned = await updater.cleanupStaleInstallers();
    assert.deepEqual(cleaned.removed.sort(), ['WindChime-Setup-1.0.0.exe', 'WindChime-Setup-1.1.0.exe', 'WindChime-Setup-1.2.0.exe.downloading']);
    assert.deepEqual(await fs.readdir(tmpDir), ['WindChime-Setup-1.2.0.exe'], 'newer pre-downloaded installer preserved');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('updater rejects corrupt SHA-256 downloads and falls back cleanly to GitHub API when mirror is unreachable', async () => {
  assert.equal(isSafeReleaseUrl('https://github.com/Morphling0717/WindChime/releases/tag/v1.2.0', 'Morphling0717/WindChime'), true);
  assert.equal(isSafeReleaseUrl('https://evil.example.com/releases/tag/v1.2.0', 'Morphling0717/WindChime'), false);

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const goodBytes = Buffer.from('good-installer');
  const signed = signManifest({
    schema: 1,
    version: '1.2.0',
    title: '风铃 1.2.0',
    publishedAt: '2026-12-01T00:00:00Z',
    notes: '',
    releasePageUrl: 'https://github.com/Morphling0717/WindChime/releases/tag/v1.2.0',
    windows: {
      fileName: 'WindChime-Setup-1.2.0.exe',
      size: goodBytes.length,
      sha256: crypto.createHash('sha256').update(goodBytes).digest('hex'),
      urls: ['https://windchime.uliuli.cn/updates/WindChime-Setup-1.2.0.exe'],
    },
  }, privateKey);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wc-updater-bad-'));
  try {
    const corruptUpdater = createUpdater({
      currentVersion: '1.1.0',
      crypto,
      fs,
      path,
      publicKeyPem: publicKey,
      getUpdatesDir: () => tmpDir,
      shell: { openExternal: async () => {} },
      fetch: async url => url.endsWith('/latest.json') ? Response.json(signed) : new Response(Buffer.from('corrupt-bytes!!'), { status: 200 }),
    });
    await corruptUpdater.check();
    await assert.rejects(() => corruptUpdater.download(), /SHA-256 不匹配/);
    assert.equal((await fs.readdir(tmpDir)).length, 0, 'corrupt file deleted automatically');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // Fallback to GitHub Releases API when primary mirror returns 503
  const opened = [];
  const fallbackUpdater = createUpdater({
    currentVersion: '1.1.0',
    crypto,
    shell: { openExternal: async url => { opened.push(url); } },
    fetch: async url => {
      if (url.includes('windchime.uliuli.cn')) return new Response('down', { status: 503 });
      return Response.json({
        tag_name: 'v1.3.0',
        name: '风铃 1.3.0',
        body: 'GitHub 兜底说明',
        html_url: 'https://github.com/Morphling0717/WindChime/releases/tag/v1.3.0',
        published_at: '2026-12-02T00:00:00Z',
      });
    },
  });
  const ghInfo = await fallbackUpdater.check();
  assert.equal(ghInfo.hasUpdate, true);
  assert.equal(ghInfo.source, 'github');
  assert.equal(ghInfo.canDownload, false);
  await fallbackUpdater.openRelease('https://evil.example.com/phish');
  assert.equal(opened[0], 'https://github.com/Morphling0717/WindChime/releases/tag/v1.3.0');
});
