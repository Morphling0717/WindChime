// Pure DI vault & workspace atomic persistence manager for WindChime Desktop.
// Never directly imports Electron or node:fs/promises so unit & VM tests inject mocks cleanly.

async function atomicRename(fs, temporary, target, setTimeoutFn) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(temporary, target);
      return;
    } catch (err) {
      if ((err?.code === 'EPERM' || err?.code === 'EBUSY') && attempt < 4) {
        await new Promise(resolve => setTimeoutFn(resolve, 35 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

function createWorkspaceStore({ fs, getPath, restoreWorkspace, sanitizeObsBridge, sanitizeLocalOverlay, sanitizeTimelineSync, onReadError, setTimeoutFn = setTimeout }) {
  let workspace = restoreWorkspace(null);
  let tail = Promise.resolve();

  function cleanValue(value) {
    for (const key of ['scrollUpShortcut', 'scrollDownShortcut', 'scrollPauseShortcut']) {
      if (!value[key]) delete value[key];
    }
    if (value.theme !== 'dark') delete value.theme;
    for (const key of ['randomDrawEnabled', 'clearOnBlindDraw', 'chimeEnabled']) {
      if (value[key] !== true) delete value[key];
    }
    if (!Number.isFinite(value.chimeVolume) || value.chimeVolume === 70) delete value.chimeVolume;
    else value.chimeVolume = Math.round(Math.min(100, Math.max(0, value.chimeVolume)));
    if (!['inbox', 'studio'].includes(value.startupView)) delete value.startupView;
    if (!['inbox', 'studio', 'topics', 'share', 'settings'].includes(value.lastView)) delete value.lastView;
    if (value.autoCheckUpdate !== false) delete value.autoCheckUpdate;
    if (value.displayMotion !== false) delete value.displayMotion;
    if (value.uiSurface !== 'standard' && value.uiSurface !== 'lite') delete value.uiSurface;
    if (
      !value.displayBounds ||
      typeof value.displayBounds !== 'object' ||
      !Number.isFinite(value.displayBounds.x) ||
      !Number.isFinite(value.displayBounds.y)
    ) {
      delete value.displayBounds;
    }
    if (
      !value.displaySize ||
      typeof value.displaySize !== 'object' ||
      !Number.isFinite(value.displaySize.width) ||
      !Number.isFinite(value.displaySize.height) ||
      value.displaySize.width < 280 ||
      value.displaySize.width > 1920 ||
      value.displaySize.height < 180 ||
      value.displaySize.height > 1080
    ) {
      delete value.displaySize;
    } else {
      value.displaySize = {
        width: Math.round(value.displaySize.width),
        height: Math.round(value.displaySize.height),
      };
    }
    const cleanObs = sanitizeObsBridge(value.obsBridge);
    if (cleanObs) value.obsBridge = cleanObs;
    else delete value.obsBridge;
    const cleanOverlay = sanitizeLocalOverlay(value.localOverlay);
    if (cleanOverlay) value.localOverlay = cleanOverlay;
    else delete value.localOverlay;
    const cleanTimeline = sanitizeTimelineSync?.(value.timelineSync);
    if (cleanTimeline) value.timelineSync = cleanTimeline;
    else delete value.timelineSync;
    return value;
  }

  async function read() {
    try {
      workspace = restoreWorkspace(JSON.parse(await fs.readFile(getPath(), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') onReadError?.('悬浮磁贴和快捷键设置无法读取，已使用默认设置');
    }
    return workspace;
  }

  function save(patch = {}) {
    return update(() => patch);
  }

  function update(mutator) {
    const op = tail.then(async () => {
      const target = getPath();
      const patch = typeof mutator === 'function' ? mutator(workspace) : mutator;
      const next = cleanValue({ ...workspace, ...(patch || {}) });
      const temporary = `${target}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(next));
      await atomicRename(fs, temporary, target, setTimeoutFn);
      workspace = next;
      return workspace;
    });
    tail = op.catch(() => {});
    return op;
  }

  return {
    get: () => workspace,
    read,
    save,
    update,
  };
}

function createVaultStore({
  fs,
  safeStorage,
  restoreSite,
  publicSite,
  getVaultPath,
  state,
  activeTopic,
  selected,
  onReadError,
  onConnectionCommitted,
  confirmDirty,
  dirtyTiles,
  getSelectionVersion,
  isSwitching,
  setTimeoutFn = setTimeout,
}) {
  let vaultTail = Promise.resolve();
  let connectionIntent = 0;
  let connectionCommit = null;

  function encrypt(sites, selectedId) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密暂不可用，无法保存设备授权');
    return safeStorage.encryptString(JSON.stringify({ version: 1, sites, selected: selectedId }));
  }

  function queue(operation) {
    const write = vaultTail.then(operation);
    vaultTail = write.catch(() => {});
    return write;
  }

  async function waitForCommit() {
    while (connectionCommit) await connectionCommit;
  }

  function connectionChanged() {
    return Object.assign(new Error('信箱选择已更新，旧操作已取消'), { code: 'CONNECTION_CHANGED' });
  }

  function beginAttempt() {
    const intent = ++connectionIntent;
    const version = getSelectionVersion();
    const sites = state.sites;
    return () => {
      if (intent !== connectionIntent || version !== getSelectionVersion() || sites !== state.sites || isSwitching()) {
        throw connectionChanged();
      }
    };
  }

  function persist(sites, selectedId, assertAttempt) {
    return queue(async () => {
      assertAttempt();
      const previous = selected();
      const next = sites.find(site => site.id === selectedId);
      const changing = state.selected !== selectedId || activeTopic(previous) !== activeTopic(next);
      const vaultPath = getVaultPath();
      const temporary = `${vaultPath}.tmp`;
      try {
        await fs.writeFile(temporary, encrypt(sites, selectedId));
      } catch {
        throw Object.assign(new Error('设备授权无法保存，原连接保持不变'), { code: 'CREDENTIAL_SAVE_FAILED' });
      }
      assertAttempt();
      if (changing) {
        await confirmDirty(dirtyTiles(), '切换信箱会放弃主窗口和悬浮磁贴中未保存的修改。', true);
        assertAttempt();
      }
      let release;
      connectionCommit = new Promise(resolve => { release = resolve; });
      try {
        try {
          await atomicRename(fs, temporary, vaultPath, setTimeoutFn);
        } catch {
          throw Object.assign(new Error('设备授权无法保存，原连接保持不变'), { code: 'CREDENTIAL_SAVE_FAILED' });
        }
        state.sites = sites;
        state.selected = selectedId;
        if (changing) {
          await onConnectionCommitted(previous);
        }
        return next ? publicSite(next) : null;
      } finally {
        connectionCommit = null;
        release();
      }
    });
  }

  function persistImported(site, assertAttempt) {
    const sites = state.sites.some(item => item.id === site.id)
      ? state.sites.map(item => (item.id === site.id ? site : item))
      : [...state.sites, site];
    return persist(sites, site.id, assertAttempt);
  }

  async function read() {
    try {
      const ciphertext = await fs.readFile(getVaultPath());
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密暂不可用');
      const stored = JSON.parse(safeStorage.decryptString(ciphertext));
      if (stored.version !== 1 || !Array.isArray(stored.sites)) throw new Error('未知设备凭据格式');
      let invalid = false;
      state.sites = stored.sites.flatMap(site => {
        try { return [restoreSite(site)]; } catch { invalid = true; return []; }
      });
      state.selected = state.sites.some(site => site.id === stored.selected) ? stored.selected : null;
      if (invalid) onReadError?.('部分本机加密凭据无法读取，请重新连接相应信箱');
    } catch (error) {
      if (error.code !== 'ENOENT') onReadError?.('本机加密凭据无法读取，请重新连接信箱');
    }
  }

  return {
    read,
    persist,
    persistImported,
    waitForCommit,
    beginAttempt,
    connectionChanged,
    hasPendingCommit: () => !!connectionCommit,
    getIntent: () => connectionIntent,
  };
}

module.exports = { atomicRename, createWorkspaceStore, createVaultStore };
