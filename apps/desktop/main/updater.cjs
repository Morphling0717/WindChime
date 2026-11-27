// Pure DI signed update checker, streaming downloader, SHA-256 verifier, and live-safe installer launcher.
// Primary feed: https://windchime.uliuli.cn/updates/latest.json (China-accessible Hong Kong mirror, Ed25519 signed).
// Fallback feed: GitHub Releases API (read-only metadata + browser download link).
// Never auto-restarts or auto-installs during a live broadcast.

const DEFAULT_FEED_URL = 'https://windchime.uliuli.cn/updates/latest.json';
const DEFAULT_PUBLIC_KEY_PEM = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAxDSLHNdrDWp2YsAVSgr7gNPB2U2c1kLPU8I1aE70qh4=',
  '-----END PUBLIC KEY-----',
].join('\n');

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'windchime.uliuli.cn',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

function parseSemver(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  };
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] > pb[key] ? 1 : -1;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;
  return pa.prerelease > pb.prerelease ? 1 : -1;
}

function isSafeReleaseUrl(url, repo) {
  if (typeof url !== 'string' || url.length > 512) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'github.com' &&
      parsed.pathname.startsWith(`/${repo}/releases/`) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function isSafeDownloadUrl(url, allowLoopback = false) {
  if (typeof url !== 'string' || url.length > 1024) return false;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    if (allowLoopback && parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
      return true;
    }
    return parsed.protocol === 'https:' && ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function canonicalPayload(manifest) {
  return JSON.stringify({
    schema: manifest.schema,
    version: manifest.version,
    title: manifest.title,
    publishedAt: manifest.publishedAt,
    notes: manifest.notes,
    releasePageUrl: manifest.releasePageUrl,
    windows: {
      fileName: manifest.windows.fileName,
      size: manifest.windows.size,
      sha256: manifest.windows.sha256,
      urls: manifest.windows.urls,
    },
  });
}

function verifySignedManifest(manifest, publicKeyPem, crypto, allowLoopback = false) {
  if (!manifest || typeof manifest !== 'object' || manifest.schema !== 1) {
    throw new Error('更新清单格式不受支持');
  }
  const parsedVer = parseSemver(manifest.version);
  if (!parsedVer) throw new Error('更新清单版本号无效');
  if (typeof manifest.signature !== 'string' || !manifest.signature.trim()) {
    throw new Error('更新清单缺少数字签名');
  }
  const win = manifest.windows;
  if (!win || typeof win !== 'object') throw new Error('更新清单缺少 Windows 安装包信息');
  if (typeof win.fileName !== 'string' || !/^WindChime-Setup-[0-9A-Za-z._-]+\.exe$/.test(win.fileName)) {
    throw new Error('安装包文件名无效');
  }
  if (typeof win.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(win.sha256)) {
    throw new Error('安装包校验哈希无效');
  }
  if (!Number.isInteger(win.size) || win.size <= 0 || win.size > 512 * 1024 * 1024) {
    throw new Error('安装包体积超出安全范围');
  }
  if (!Array.isArray(win.urls) || !win.urls.length || win.urls.length > 5) {
    throw new Error('更新清单缺少下载地址');
  }
  for (const u of win.urls) {
    if (!isSafeDownloadUrl(u, allowLoopback)) throw new Error('更新清单包含不受信任的下载地址');
  }
  const payload = Buffer.from(canonicalPayload(manifest), 'utf8');
  const sig = Buffer.from(manifest.signature, 'base64');
  const ok = crypto.verify(null, payload, publicKeyPem, sig);
  if (!ok) throw new Error('更新清单数字签名校验失败，已拒绝使用');
  return {
    version: `${parsedVer.major}.${parsedVer.minor}.${parsedVer.patch}${parsedVer.prerelease ? `-${parsedVer.prerelease}` : ''}`,
    title: typeof manifest.title === 'string' ? manifest.title.trim().slice(0, 140) : `风铃 ${manifest.version}`,
    notes: typeof manifest.notes === 'string' ? manifest.notes.replace(/\r\n/g, '\n').trim().slice(0, 1800) : '',
    publishedAt: typeof manifest.publishedAt === 'string' ? manifest.publishedAt : '',
    releasePageUrl: typeof manifest.releasePageUrl === 'string' ? manifest.releasePageUrl : '',
    windows: {
      fileName: win.fileName,
      size: win.size,
      sha256: win.sha256.toLowerCase(),
      urls: [...win.urls],
    },
  };
}

function createUpdater({
  fetch,
  shell,
  crypto,
  fs,
  path,
  spawn,
  getUpdatesDir,
  onStateChange,
  onBeforeInstallQuit,
  currentVersion,
  repo = 'Morphling0717/WindChime',
  feedUrl = DEFAULT_FEED_URL,
  publicKeyPem = DEFAULT_PUBLIC_KEY_PEM,
  allowLoopback = false,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let state = {
    currentVersion,
    latestVersion: currentVersion,
    hasUpdate: false,
    verified: false,
    canDownload: false,
    source: '',
    stage: 'idle', // 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'ready' | 'error'
    title: '',
    notes: '',
    url: `https://github.com/${repo}/releases`,
    publishedAt: '',
    checkedAt: '',
    error: '',
    installerFileName: '',
    installerSize: 0,
    installerSha256: '',
    downloadUrls: [],
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
    speedBytesPerSec: 0,
  };
  let downloadedPath = '';
  let checkInflight = null;
  let downloadController = null;

  function publicInfo() {
    const { downloadUrls, ...rest } = state;
    return { ...rest };
  }

  function emit() {
    onStateChange?.(publicInfo());
  }

  async function fetchSignedFeed() {
    if (!feedUrl) return null;
    const controller = new AbortController();
    const timer = setTimeoutFn(() => controller.abort(), 8000);
    timer.unref?.();
    try {
      const response = await fetch(feedUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': `WindChime-Desktop/${currentVersion}`,
        },
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`更新源暂不可用（HTTP ${response.status}）`);
      const raw = await response.json();
      return verifySignedManifest(raw, publicKeyPem, crypto, allowLoopback);
    } finally {
      clearTimeoutFn(timer);
    }
  }

  async function fetchGitHubFallback() {
    const controller = new AbortController();
    const timer = setTimeoutFn(() => controller.abort(), 8000);
    timer.unref?.();
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': `WindChime-Desktop/${currentVersion}`,
        },
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'follow',
      });
      if (!response.ok) {
        throw new Error(response.status === 403 ? 'GitHub 访问频次受限，请稍后再试' : `检查更新失败（HTTP ${response.status}）`);
      }
      const data = await response.json();
      const tag = typeof data?.tag_name === 'string' ? data.tag_name.trim() : '';
      const parsedLatest = parseSemver(tag);
      if (!parsedLatest) throw new Error('远端版本号格式无效');
      const latestVersion = `${parsedLatest.major}.${parsedLatest.minor}.${parsedLatest.patch}${parsedLatest.prerelease ? `-${parsedLatest.prerelease}` : ''}`;
      const releaseUrl = isSafeReleaseUrl(data?.html_url, repo)
        ? data.html_url
        : `https://github.com/${repo}/releases`;
      return {
        version: latestVersion,
        title: typeof data?.name === 'string' ? data.name.trim().slice(0, 140) : `v${latestVersion}`,
        notes: typeof data?.body === 'string' ? data.body.replace(/\r\n/g, '\n').trim().slice(0, 1800) : '',
        publishedAt: typeof data?.published_at === 'string' ? data.published_at : '',
        releasePageUrl: releaseUrl,
      };
    } finally {
      clearTimeoutFn(timer);
    }
  }

  async function check() {
    if (checkInflight) return checkInflight;
    if (state.stage === 'downloading' || state.stage === 'verifying') return publicInfo();
    checkInflight = (async () => {
      try {
        let primaryErr = null;
        if (feedUrl && crypto?.verify) {
          try {
            const manifest = await fetchSignedFeed();
            if (manifest) {
              const hasUpdate = compareSemver(manifest.version, currentVersion) > 0;
              const releaseUrl = isSafeReleaseUrl(manifest.releasePageUrl, repo)
                ? manifest.releasePageUrl
                : `https://github.com/${repo}/releases`;
              const alreadyReady =
                state.stage === 'ready' &&
                downloadedPath &&
                state.installerSha256 === manifest.windows.sha256;
              state = {
                ...state,
                currentVersion,
                latestVersion: manifest.version,
                hasUpdate,
                verified: true,
                canDownload: hasUpdate && Boolean(fs && path && getUpdatesDir),
                source: 'windchime-mirror',
                stage: hasUpdate ? (alreadyReady ? 'ready' : 'available') : 'idle',
                title: manifest.title,
                notes: manifest.notes,
                url: releaseUrl,
                publishedAt: manifest.publishedAt,
                checkedAt: new Date().toISOString(),
                error: '',
                installerFileName: manifest.windows.fileName,
                installerSize: manifest.windows.size,
                installerSha256: manifest.windows.sha256,
                downloadUrls: manifest.windows.urls,
              };
              emit();
              return publicInfo();
            }
          } catch (err) {
            primaryErr = err;
            // Never fall back silently on signature tampering!
            if (err instanceof Error && err.message.includes('数字签名')) throw err;
          }
        }

        // Fallback to GitHub Releases API (e.g., if primary feed unreachable)
        try {
          const gh = await fetchGitHubFallback();
          const hasUpdate = compareSemver(gh.version, currentVersion) > 0;
          if (state.stage === 'ready' && downloadedPath && compareSemver(gh.version, state.latestVersion) <= 0) {
            state = {
              ...state,
              checkedAt: new Date().toISOString(),
              error: '',
            };
            emit();
            return publicInfo();
          }
          state = {
            ...state,
            currentVersion,
            latestVersion: gh.version,
            hasUpdate,
            verified: false,
            canDownload: false,
            source: 'github',
            stage: hasUpdate ? 'available' : 'idle',
            title: gh.title,
            notes: gh.notes,
            url: gh.releasePageUrl,
            publishedAt: gh.publishedAt,
            checkedAt: new Date().toISOString(),
            error: '',
            installerFileName: '',
            installerSize: 0,
            installerSha256: '',
            downloadUrls: [],
          };
          emit();
          return publicInfo();
        } catch (ghErr) {
          throw primaryErr || ghErr;
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : '无法连接更新服务器，请检查网络后重试';
        state = {
          ...state,
          checkedAt: new Date().toISOString(),
          error: message,
        };
        emit();
        return publicInfo();
      } finally {
        checkInflight = null;
      }
    })();
    return checkInflight;
  }

  async function hashFile(filePath) {
    const data = await fs.readFile(filePath);
    return {
      sha256: crypto.createHash('sha256').update(data).digest('hex').toLowerCase(),
      size: data.length,
    };
  }

  async function downloadFromUrl(targetUrl, partPath, signal) {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'user-agent': `WindChime-Desktop/${currentVersion}` },
      signal,
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
    const headerLen = Number(response.headers.get('content-length') || 0);
    const total = headerLen > 0 ? headerLen : state.installerSize;
    state.totalBytes = total;

    const handle = typeof fs.open === 'function' ? await fs.open(partPath, 'w') : null;
    const chunks = handle ? null : [];
    let received = 0;
    let lastEmitAt = 0;
    let lastSampleAt = Date.now();
    let lastSampleBytes = 0;

    try {
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const buf = Buffer.from(value);
          received += buf.length;
          if (received > 512 * 1024 * 1024) throw new Error('安装包体积超出安全限制');
          if (handle) await handle.write(buf);
          else chunks.push(buf);

          const now = Date.now();
          if (now - lastEmitAt >= 180) {
            const elapsedSec = Math.max(0.1, (now - lastSampleAt) / 1000);
            const speed = Math.round((received - lastSampleBytes) / elapsedSec);
            lastSampleAt = now;
            lastSampleBytes = received;
            lastEmitAt = now;
            state.downloadedBytes = received;
            state.percent = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0;
            state.speedBytesPerSec = Math.max(0, speed);
            emit();
          }
        }
      } else {
        const buf = Buffer.from(await response.arrayBuffer());
        if (buf.length > 512 * 1024 * 1024) throw new Error('安装包体积超出安全限制');
        received = buf.length;
        if (handle) await handle.write(buf);
        else chunks.push(buf);
      }
      if (!handle) {
        await fs.writeFile(partPath, Buffer.concat(chunks));
      }
      state.downloadedBytes = received;
      state.percent = 100;
    } finally {
      if (handle) await handle.close();
    }
  }

  async function download() {
    if (!state.hasUpdate || !state.verified || !state.downloadUrls.length || !state.installerSha256) {
      throw new Error('当前没有可应用内下载的已签名更新，请先检查更新');
    }
    if (state.stage === 'downloading' || state.stage === 'verifying') return publicInfo();
    if (!fs || !path || !getUpdatesDir) throw new Error('当前运行环境不支持应用内下载');

    const dir = getUpdatesDir();
    await fs.mkdir?.(dir, { recursive: true });
    const finalPath = path.join(dir, state.installerFileName);
    const partPath = `${finalPath}.downloading`;

    // Reuse previously verified installer if already on disk
    try {
      const existing = await hashFile(finalPath);
      if (existing.sha256 === state.installerSha256 && existing.size === state.installerSize) {
        downloadedPath = finalPath;
        state = { ...state, stage: 'ready', downloadedBytes: existing.size, totalBytes: existing.size, percent: 100, speedBytesPerSec: 0, error: '' };
        emit();
        return publicInfo();
      }
    } catch {}

    downloadController = new AbortController();
    downloadedPath = '';
    state = {
      ...state,
      stage: 'downloading',
      downloadedBytes: 0,
      totalBytes: state.installerSize,
      percent: 0,
      speedBytesPerSec: 0,
      error: '',
    };
    emit();

    let lastErr = null;
    try {
      for (const candidateUrl of state.downloadUrls) {
        if (!isSafeDownloadUrl(candidateUrl, allowLoopback)) continue;
        try {
          await downloadFromUrl(candidateUrl, partPath, downloadController.signal);
          lastErr = null;
          break;
        } catch (err) {
          if (downloadController.signal.aborted) throw new Error('已取消下载更新');
          lastErr = err;
          try { await fs.unlink?.(partPath); } catch {}
        }
      }
      if (lastErr) throw lastErr;

      state = { ...state, stage: 'verifying', speedBytesPerSec: 0 };
      emit();
      const verified = await hashFile(partPath);
      if (verified.sha256 !== state.installerSha256 || verified.size !== state.installerSize) {
        try { await fs.unlink?.(partPath); } catch {}
        throw new Error('安装包完整性校验失败（SHA-256 不匹配），已自动删除');
      }

      // Remove stale installers from older downloads
      try {
        const files = await fs.readdir?.(dir);
        if (Array.isArray(files)) {
          for (const name of files) {
            if (name !== state.installerFileName && name !== `${state.installerFileName}.downloading`) {
              await fs.unlink?.(path.join(dir, name)).catch(() => {});
            }
          }
        }
      } catch {}

      for (let attempt = 0; ; attempt++) {
        try {
          await fs.rename(partPath, finalPath);
          break;
        } catch (err) {
          if ((err?.code === 'EPERM' || err?.code === 'EBUSY') && attempt < 4) {
            await new Promise(resolve => setTimeoutFn(resolve, 60 * (attempt + 1)));
            continue;
          }
          throw err;
        }
      }
      downloadedPath = finalPath;
      state = { ...state, stage: 'ready', percent: 100, downloadedBytes: verified.size, totalBytes: verified.size, speedBytesPerSec: 0, error: '' };
      emit();
      return publicInfo();
    } catch (error) {
      try { await fs.unlink?.(partPath); } catch {}
      const cancelled = downloadController?.signal.aborted;
      state = {
        ...state,
        stage: cancelled ? 'available' : 'error',
        speedBytesPerSec: 0,
        error: cancelled ? '' : (error instanceof Error && error.message ? error.message : '下载更新失败'),
      };
      emit();
      if (!cancelled) throw error;
      return publicInfo();
    } finally {
      downloadController = null;
    }
  }

  function cancelDownload() {
    if (downloadController) {
      downloadController.abort();
      return true;
    }
    return false;
  }

  async function install() {
    if (state.stage !== 'ready' || !downloadedPath || !state.installerSha256) {
      throw new Error('更新安装包尚未就绪，请先下载完成');
    }
    if (!fs || !spawn) throw new Error('当前环境不支持直接启动安装程序');
    // Re-verify SHA-256 right before execution (TOCTOU protection)
    const checkDisk = await hashFile(downloadedPath);
    if (checkDisk.sha256 !== state.installerSha256 || checkDisk.size !== state.installerSize) {
      downloadedPath = '';
      state = { ...state, stage: 'available', error: '安装包文件已变更，请重新下载' };
      emit();
      throw new Error('安装包校验失效，请重新下载');
    }
    const child = spawn(downloadedPath, [], { detached: true, stdio: 'ignore' });
    child.unref?.();
    onBeforeInstallQuit?.();
    return true;
  }

  async function openRelease(url) {
    const target = typeof url === 'string' && isSafeReleaseUrl(url, repo)
      ? url
      : isSafeReleaseUrl(state.url, repo)
        ? state.url
        : `https://github.com/${repo}/releases`;
    await shell.openExternal(target);
    return true;
  }

  return {
    getInfo: publicInfo,
    check,
    download,
    cancelDownload,
    install,
    openRelease,
  };
}

module.exports = {
  DEFAULT_FEED_URL,
  DEFAULT_PUBLIC_KEY_PEM,
  parseSemver,
  compareSemver,
  isSafeReleaseUrl,
  isSafeDownloadUrl,
  canonicalPayload,
  verifySignedManifest,
  createUpdater,
};
