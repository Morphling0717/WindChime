// Pure DI GitHub Releases update checker (read-only, never auto-restarts during live streams).

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

function createUpdater({
  fetch,
  shell,
  currentVersion,
  repo = 'Morphling0717/WindChime',
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let lastResult = {
    currentVersion,
    latestVersion: currentVersion,
    hasUpdate: false,
    title: '',
    notes: '',
    url: `https://github.com/${repo}/releases`,
    publishedAt: '',
    checkedAt: '',
    error: '',
  };
  let inflight = null;

  async function check() {
    if (inflight) return inflight;
    inflight = (async () => {
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
        const notes = typeof data?.body === 'string'
          ? data.body.replace(/\r\n/g, '\n').trim().slice(0, 1500)
          : '';
        lastResult = {
          currentVersion,
          latestVersion,
          hasUpdate: compareSemver(latestVersion, currentVersion) > 0,
          title: typeof data?.name === 'string' ? data.name.trim().slice(0, 140) : `v${latestVersion}`,
          notes,
          url: releaseUrl,
          publishedAt: typeof data?.published_at === 'string' ? data.published_at : '',
          checkedAt: new Date().toISOString(),
          error: '',
        };
        return { ...lastResult };
      } catch (error) {
        const message = controller.signal.aborted
          ? '检查更新超时，请稍后重试'
          : error instanceof Error && error.message
            ? error.message
            : '无法连接 GitHub 检查更新';
        lastResult = {
          ...lastResult,
          checkedAt: new Date().toISOString(),
          error: message,
        };
        return { ...lastResult };
      } finally {
        clearTimeoutFn(timer);
        inflight = null;
      }
    })();
    return inflight;
  }

  async function openRelease(url) {
    const target = typeof url === 'string' && isSafeReleaseUrl(url, repo)
      ? url
      : isSafeReleaseUrl(lastResult.url, repo)
        ? lastResult.url
        : `https://github.com/${repo}/releases`;
    await shell.openExternal(target);
    return true;
  }

  return {
    getInfo: () => ({ ...lastResult }),
    check,
    openRelease,
  };
}

module.exports = { parseSemver, compareSemver, isSafeReleaseUrl, createUpdater };
