// Pure DI global shortcut manager (hide, next-letter, and optional scroll hotkeys).

function createShortcutManager({
  globalShortcut,
  HIDE_SHORTCUT,
  normalizeShortcut,
  normalizeNextShortcut,
  saveWorkspace,
  onHide,
  onNextLetter,
  onScrollCommand,
  onConnectionError,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let nextShortcut = '';
  let nextRegistered = false;
  let shortcutError = '';
  let nextActionError = '';
  let nextVersion = 0;
  let nextPending = false;
  let lastNextAt = -Infinity;

  let scrollShortcuts = { up: '', down: '', pause: '' };
  let scrollRegistered = { up: false, down: false, pause: false };
  let scrollShortcutError = '';

  let shortcutRecording = false;
  let shortcutRecordingTimer;
  let configTail = Promise.resolve();
  let configPending = 0;

  function scrollHotkeyCommand(slot) {
    return slot === 'up'
      ? { type: 'step', delta: -0.45 }
      : slot === 'down'
        ? { type: 'step', delta: 0.45 }
        : { type: 'togglePause' };
  }

  function registerScrollBinding(slot, accelerator) {
    if (!accelerator) return true;
    try {
      return !!globalShortcut.register(accelerator, () => {
        if (!shortcutRecording && scrollRegistered[slot] && scrollShortcuts[slot] === accelerator) {
          try { onScrollCommand(scrollHotkeyCommand(slot)); } catch {}
        }
      });
    } catch {
      return false;
    }
  }

  async function triggerNext(perfNow) {
    if (shortcutRecording) return;
    const now = perfNow();
    if (nextPending || now - lastNextAt < 600) return;
    lastNextAt = now;
    nextPending = true;
    nextActionError = '';
    try {
      const capturedVersion = nextVersion;
      await onNextLetter(() => capturedVersion === nextVersion);
    } catch (error) {
      nextActionError = error.message || '下一封操作失败，请检查网站连接';
    } finally {
      nextPending = false;
    }
  }

  async function configureScroll(input) {
    if (shortcutRecording) throw new Error('请先结束快捷键录制');
    if (!input || typeof input !== 'object') throw new Error('无效滚动快捷键设置');
    configPending++;
    const operation = configTail.then(async () => {
      if (shortcutRecording) throw new Error('请先结束快捷键录制');
      const candidate = {
        up: input.up !== undefined ? normalizeShortcut(input.up, '向上滚动快捷键') : scrollShortcuts.up,
        down: input.down !== undefined ? normalizeShortcut(input.down, '向下滚动快捷键') : scrollShortcuts.down,
        pause: input.pause !== undefined ? normalizeShortcut(input.pause, '暂停滚动快捷键') : scrollShortcuts.pause,
      };
      const seen = new Set([HIDE_SHORTCUT, nextShortcut].filter(Boolean));
      for (const slot of ['up', 'down', 'pause']) {
        const value = candidate[slot];
        if (!value) continue;
        if (seen.has(value)) throw new Error('快捷键与已有热键冲突，请选择其他组合键');
        seen.add(value);
      }
      const newlyRegistered = [];
      try {
        for (const slot of ['up', 'down', 'pause']) {
          const value = candidate[slot];
          if (!value) continue;
          if (value === scrollShortcuts[slot] && scrollRegistered[slot]) continue;
          if (!registerScrollBinding(slot, value)) {
            throw new Error('滚动快捷键已被系统或其他应用占用，原设置保持不变');
          }
          newlyRegistered.push(value);
        }
      } catch (error) {
        for (const key of newlyRegistered) globalShortcut.unregister(key);
        scrollShortcutError = error.message;
        throw error;
      }
      const previous = { ...scrollShortcuts };
      try {
        await saveWorkspace({
          scrollUpShortcut: candidate.up,
          scrollDownShortcut: candidate.down,
          scrollPauseShortcut: candidate.pause,
        });
      } catch {
        for (const key of newlyRegistered) globalShortcut.unregister(key);
        scrollShortcutError = '滚动快捷键设置无法保存，原设置保持不变';
        throw new Error(scrollShortcutError);
      }
      for (const slot of ['up', 'down', 'pause']) {
        const oldKey = previous[slot];
        if (oldKey && oldKey !== candidate[slot] && !Object.values(candidate).includes(oldKey)) {
          globalShortcut.unregister(oldKey);
        }
      }
      scrollShortcuts = candidate;
      scrollRegistered = { up: !!candidate.up, down: !!candidate.down, pause: !!candidate.pause };
      scrollShortcutError = '';
      return { ...scrollShortcuts, error: '' };
    });
    configTail = operation.catch(() => {});
    try { return await operation; } finally { configPending--; }
  }

  async function configureNext(value, perfNow) {
    if (shortcutRecording) throw new Error('请先结束快捷键录制');
    configPending++;
    const operation = configTail.then(async () => {
      if (shortcutRecording) throw new Error('请先结束快捷键录制');
      const normalized = normalizeNextShortcut(value);
      if (normalized && Object.values(scrollShortcuts).includes(normalized)) {
        shortcutError = '快捷键与滚动热键冲突，请选择其他组合键';
        throw new Error(shortcutError);
      }
      if (normalized === nextShortcut && (!normalized || nextRegistered)) {
        shortcutError = '';
        return nextShortcut;
      }
      if (normalized) {
        try {
          if (!globalShortcut.register(normalized, () => {
            if (nextRegistered && nextShortcut === normalized) void triggerNext(perfNow);
          })) throw new Error();
        } catch {
          shortcutError = '快捷键已被系统或其他应用占用，原快捷键保持不变';
          throw new Error(shortcutError);
        }
      }
      const previous = nextShortcut;
      const wasRegistered = nextRegistered;
      try {
        await saveWorkspace({ nextShortcut: normalized });
      } catch {
        if (normalized) globalShortcut.unregister(normalized);
        shortcutError = '快捷键设置无法保存，原快捷键保持不变';
        throw new Error(shortcutError);
      }
      if (previous && wasRegistered && previous !== normalized) globalShortcut.unregister(previous);
      nextVersion++;
      nextShortcut = normalized;
      nextRegistered = !!normalized;
      shortcutError = '';
      return normalized;
    });
    configTail = operation.catch(() => {});
    try { return await operation; } finally { configPending--; }
  }

  function setRecording(recording, perfNow) {
    if (typeof recording !== 'boolean') throw new Error('无效录制状态');
    if (recording && configPending) throw new Error('热键正在保存，请稍后开始录制');
    clearTimeoutFn(shortcutRecordingTimer);
    if (recording) {
      nextVersion++;
      shortcutRecording = true;
      if (nextShortcut && nextRegistered) {
        globalShortcut.unregister(nextShortcut);
        nextRegistered = false;
      }
      for (const slot of ['up', 'down', 'pause']) {
        if (scrollShortcuts[slot] && scrollRegistered[slot]) {
          globalShortcut.unregister(scrollShortcuts[slot]);
          scrollRegistered[slot] = false;
        }
      }
      shortcutRecordingTimer = setTimeoutFn(() => setRecording(false, perfNow), 30000);
      shortcutRecordingTimer.unref?.();
    } else if (shortcutRecording) {
      shortcutRecording = false;
      if (nextShortcut) {
        try {
          if (!globalShortcut.register(nextShortcut, () => { void triggerNext(perfNow); })) throw new Error();
          nextRegistered = true;
        } catch {
          nextRegistered = false;
          shortcutError = '录制结束后无法恢复原下一封快捷键，请在设置中重新选择';
        }
      }
      for (const slot of ['up', 'down', 'pause']) {
        if (scrollShortcuts[slot]) {
          if (registerScrollBinding(slot, scrollShortcuts[slot])) scrollRegistered[slot] = true;
          else {
            scrollRegistered[slot] = false;
            scrollShortcutError = '录制结束后无法恢复部分滚动快捷键，请在设置中重新选择';
          }
        }
      }
    }
    return shortcutRecording;
  }

  function registerInitial(workspace, perfNow) {
    try {
      if (!globalShortcut.register(HIDE_SHORTCUT, () => void onHide())) {
        onConnectionError?.('Ctrl+Shift+H 快捷键注册失败，请使用一键隐藏按钮或托盘菜单');
      }
    } catch {
      onConnectionError?.('Ctrl+Shift+H 快捷键注册失败，请使用一键隐藏按钮或托盘菜单');
    }
    if (workspace.nextShortcut) {
      nextShortcut = workspace.nextShortcut;
      try {
        if (!globalShortcut.register(workspace.nextShortcut, () => { void triggerNext(perfNow); })) throw new Error();
        nextRegistered = true;
      } catch {
        nextRegistered = false;
        shortcutError = '保存的下一封快捷键无法注册，请在设置中选择其他快捷键';
      }
    }
    const savedScroll = {
      up: workspace.scrollUpShortcut || '',
      down: workspace.scrollDownShortcut || '',
      pause: workspace.scrollPauseShortcut || '',
    };
    for (const slot of ['up', 'down', 'pause']) {
      if (!savedScroll[slot]) continue;
      scrollShortcuts[slot] = savedScroll[slot];
      if (registerScrollBinding(slot, savedScroll[slot])) scrollRegistered[slot] = true;
      else scrollShortcutError = '部分保存的滚动快捷键无法注册，请在设置中重新选择';
    }
  }

  return {
    registerInitial,
    configureNext,
    configureScroll,
    setRecording,
    bumpNextVersion: () => { nextVersion++; },
    getStatus: () => ({
      shortcut: 'Ctrl+Shift+H',
      nextShortcut,
      shortcutRecording,
      shortcutError,
      nextActionError,
      nextPending,
    }),
    getScrollStatus: () => ({ ...scrollShortcuts, error: scrollShortcutError }),
  };
}

module.exports = { createShortcutManager };
