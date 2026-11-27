import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  shortcutLabel,
  unwrap,
  type DesktopPrefs,
  type DesktopStartupView,
  type DesktopStatus,
  type DesktopUiSurface,
  type ScrollShortcuts,
  type TimelineSyncStatus,
} from './bridge';
import { playWindChime } from './chime';

const bridge = window.windchimeDesktop;
function normalizeDisplayAccelerator(value: string) {
  return shortcutLabel(value || '').trim();
}
function canonicalKeyCompare(a: string, b: string) {
  return normalizeDisplayAccelerator(a).toLowerCase() === normalizeDisplayAccelerator(b).toLowerCase();
}
function accelerator(event: KeyboardEvent<HTMLInputElement>) {
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code) ? event.code : ({ ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Space: 'Space', Enter: 'Enter', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete' } as Record<string, string>)[event.code];
  return key ? [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Super' : '', key].filter(Boolean).join('+') : null;
}

type Slot = 'next' | 'up' | 'down' | 'pause';

export function Hotkeys({
  status,
  onSaved,
  prefs,
  onUpdatePrefs,
  timelineStatus,
  onTimelineChange,
}: {
  status: DesktopStatus;
  onSaved: () => Promise<void>;
  prefs?: DesktopPrefs;
  onUpdatePrefs?: (patch: Partial<DesktopPrefs>) => Promise<void>;
  timelineStatus?: TimelineSyncStatus | null;
  onTimelineChange?: (next: TimelineSyncStatus) => void;
}) {
  const [roomInput, setRoomInput] = useState(timelineStatus?.config.bilibiliRoomId ?? '');
  const [wsPortInput, setWsPortInput] = useState(String(timelineStatus?.config.obsWsPort ?? 4455));
  const [wsPasswordInput, setWsPasswordInput] = useState('');
  const [timelineBusy, setTimelineBusy] = useState(false);
  const [timelineNotice, setTimelineNotice] = useState('');
  const [timelineError, setTimelineError] = useState('');
  const syncedRoomRef = useRef(timelineStatus?.config.bilibiliRoomId ?? '');
  const syncedPortRef = useRef(String(timelineStatus?.config.obsWsPort ?? 4455));
  useEffect(() => {
    const nextRoom = timelineStatus?.config.bilibiliRoomId ?? '';
    if (nextRoom !== syncedRoomRef.current) {
      syncedRoomRef.current = nextRoom;
      setRoomInput(nextRoom);
    }
    const nextPort = String(timelineStatus?.config.obsWsPort ?? 4455);
    if (nextPort !== syncedPortRef.current) {
      syncedPortRef.current = nextPort;
      setWsPortInput(nextPort);
    }
  }, [timelineStatus?.config.bilibiliRoomId, timelineStatus?.config.obsWsPort]);

  const [chimeVolumeDraft, setChimeVolumeDraft] = useState(prefs?.chimeVolume ?? 70);
  const chimeTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (prefs) setChimeVolumeDraft(prefs.chimeVolume);
  }, [prefs?.chimeVolume]);
  useEffect(() => () => {
    if (chimeTimerRef.current !== null) window.clearTimeout(chimeTimerRef.current);
  }, []);
  const safeUpdatePrefs = (patch: Partial<DesktopPrefs>) => {
    if (!onUpdatePrefs) return;
    void onUpdatePrefs(patch).catch(e => {
      if (alive.current) setError(e instanceof Error ? e.message : '保存桌面偏好失败');
    });
  };

  const applyTimelineConfig = async (
    patch: Parameters<typeof bridge.configureTimeline>[0],
    successMsg = '',
  ): Promise<TimelineSyncStatus | null> => {
    if (timelineBusy) return null;
    setTimelineBusy(true);
    setTimelineError('');
    setTimelineNotice('');
    try {
      const next = await unwrap(bridge.configureTimeline(patch));
      onTimelineChange?.(next);
      const hasWsFailure =
        ('obsWsPort' in patch || 'obsWsPassword' in patch || 'obsWsEnabled' in patch) &&
        next.config.obsWsEnabled &&
        Boolean(next.obsWs.authError);
      const hasBiliFailure = 'bilibiliRoomId' in patch && Boolean(next.bilibili.error);
      if (successMsg && !hasWsFailure && !hasBiliFailure) {
        if (
          ('obsWsPort' in patch || 'obsWsPassword' in patch) &&
          next.config.obsWsEnabled &&
          !next.obsWs.reachable
        ) {
          setTimelineNotice('已保存 OBS WebSocket 配置；当前未检测到运行中的 OBS WebSocket 服务（请确认 OBS 已开启 WebSocket 服务器）。');
        } else {
          setTimelineNotice(successMsg);
        }
      }
      return next;
    } catch (e) {
      setTimelineError(e instanceof Error ? e.message : '保存时间轴同步设置失败');
      return null;
    } finally {
      setTimelineBusy(false);
    }
  };

  const probeTimelineNow = async () => {
    if (timelineBusy) return;
    setTimelineBusy(true);
    setTimelineError('');
    setTimelineNotice('');
    try {
      const next = await unwrap(bridge.syncTimelineNow({ forceApply: true }));
      onTimelineChange?.(next);
      const hasAutoLive = Boolean(
        next.obsWs.streamActive ||
        next.obsWs.recordActive ||
        next.obsLog.streamActive ||
        next.obsLog.recordActive ||
        next.bilibili.live,
      );
      if (hasAutoLive && next.anchor.startedAt && next.anchor.label) {
        setTimelineNotice(`已完成检测，当前对齐基准：${next.anchor.label}（${new Date(next.anchor.startedAt).toLocaleTimeString('zh-CN', { hour12: false })}）。`);
      } else if (next.anchor.startedAt && next.anchor.source === 'manual') {
        setTimelineNotice('当前尚未检测到开播中的 OBS 或 B站直播间，已继续沿用你的手动开播时间标记。');
      } else {
        setTimelineNotice('已完成检测，当前尚未检测到正在开播的 OBS 或 B站直播间。');
      }
    } catch (e) {
      setTimelineError(e instanceof Error ? e.message : '检测同步失败');
    } finally {
      setTimelineBusy(false);
    }
  };
  const [value, setValue] = useState(normalizeDisplayAccelerator(status.nextShortcut ?? ''));
  const [basis, setBasis] = useState(normalizeDisplayAccelerator(status.nextShortcut ?? ''));
  const [scrollValues, setScrollValues] = useState<ScrollShortcuts>({ up: '', down: '', pause: '' });
  const [scrollBasis, setScrollBasis] = useState<ScrollShortcuts>({ up: '', down: '', pause: '' });
  const [scrollError, setScrollError] = useState('');
  const [recordingSlot, setRecordingSlot] = useState<Slot | null>(null);
  const recordingSlotRef = useRef<Slot | null>(null);
  recordingSlotRef.current = recordingSlot;
  const [awaitingRelease, setAwaitingRelease] = useState(false);
  const captured = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputs = useRef<Record<Slot, HTMLInputElement | null>>({ next: null, up: null, down: null, pause: null });
  const alive = useRef(true);

  const refreshScrollShortcuts = () => {
    void unwrap(bridge.getScrollShortcuts()).then(result => {
      if (!alive.current) return;
      const clean = {
        up: normalizeDisplayAccelerator(result.up ?? ''),
        down: normalizeDisplayAccelerator(result.down ?? ''),
        pause: normalizeDisplayAccelerator(result.pause ?? ''),
      };
      setScrollValues(clean);
      setScrollBasis(clean);
      setScrollError(result.error ?? '');
    }).catch(() => {});
  };

  useEffect(() => {
    refreshScrollShortcuts();
  }, []);

  useEffect(() => {
    const normalized = normalizeDisplayAccelerator(status.nextShortcut ?? '');
    if (value === basis && normalized !== basis) {
      setValue(normalized);
      setBasis(normalized);
    }
  }, [status.nextShortcut, value, basis]);

  const stopRecording = () => {
    captured.current = false;
    setAwaitingRelease(false);
    setRecordingSlot(null);
    void unwrap(bridge.setShortcutRecording(false))
      .then(() => {
        if (alive.current) refreshScrollShortcuts();
      })
      .catch(e => {
        if (alive.current) setError(e instanceof Error ? e.message : '无法恢复热键');
      });
  };

  useEffect(() => {
    alive.current = true;
    const stop = () => {
      if (recordingSlotRef.current !== null || captured.current) stopRecording();
    };
    window.addEventListener('blur', stop);
    return () => {
      alive.current = false;
      window.removeEventListener('blur', stop);
      if (recordingSlotRef.current !== null || captured.current) {
        void unwrap(bridge.setShortcutRecording(false)).catch(() => {});
      }
    };
  }, []);
  useEffect(() => { if (!recordingSlot) return; const timeout = setTimeout(stopRecording, 25000); return () => clearTimeout(timeout); }, [recordingSlot]);

  const startRecording = async (slot: Slot) => {
    setError(''); setNotice('');
    try {
      await unwrap(bridge.setShortcutRecording(true));
      if (alive.current) {
        captured.current = false;
        setAwaitingRelease(false);
        setRecordingSlot(slot);
        inputs.current[slot]?.focus();
      }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '无法录制热键'); }
  };

  const record = (slot: Slot, event: KeyboardEvent<HTMLInputElement>) => {
    if (recordingSlot !== slot) return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat || captured.current) return;
    if (event.key === 'Escape') {
      stopRecording();
      return;
    }
    const result = accelerator(event);
    if (!result) return;
    if (slot === 'next') setValue(result);
    else setScrollValues(current => ({ ...current, [slot]: result }));
    captured.current = true; setAwaitingRelease(true);
  };

  const release = async (slot: Slot, event: KeyboardEvent<HTMLInputElement>) => {
    if (recordingSlot !== slot || !captured.current || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    event.preventDefault();
    stopRecording();
  };

  const saveNext = async (candidate: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice(''); setRecordingSlot(null);
    try {
      await unwrap(bridge.setShortcutRecording(false));
      await unwrap(bridge.setNextShortcut(candidate));
      const clean = normalizeDisplayAccelerator(candidate);
      if (alive.current) { setValue(clean); setBasis(clean); setNotice(clean ? '下一封热键已保存，切到其他窗口也可使用。' : '已关闭下一封热键。'); }
      await onSaved();
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '热键保存失败'); }
    finally { if (alive.current) setBusy(false); }
  };

  const saveScroll = async (slot: 'up' | 'down' | 'pause', candidate: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice(''); setRecordingSlot(null);
    try {
      await unwrap(bridge.setShortcutRecording(false));
      const updated = await unwrap(bridge.setScrollShortcuts({ [slot]: candidate }));
      if (alive.current) {
        const clean = {
          up: normalizeDisplayAccelerator(updated.up ?? ''),
          down: normalizeDisplayAccelerator(updated.down ?? ''),
          pause: normalizeDisplayAccelerator(updated.pause ?? ''),
        };
        setScrollValues(clean);
        setScrollBasis(clean);
        setScrollError(updated.error ?? '');
        const labelMap = { up: '向上滚动', down: '向下滚动', pause: '暂停 / 继续滚动' };
        setNotice(candidate ? `${labelMap[slot]}热键已保存。` : `已关闭${labelMap[slot]}热键。`);
      }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '滚动热键保存失败'); }
    finally { if (alive.current) setBusy(false); }
  };

  const scrollRows: Array<{ slot: 'up' | 'down' | 'pause'; label: string; placeholder: string }> = [
    { slot: 'up', label: '向上滚动热键（可选）', placeholder: '例如 Alt+Up' },
    { slot: 'down', label: '向下滚动热键（可选）', placeholder: '例如 Alt+Down' },
    { slot: 'pause', label: '暂停 / 继续滚动热键（可选）', placeholder: '例如 Alt+Space' },
  ];

  return <div className="desktop-controls-stack">
    {prefs && onUpdatePrefs ? (
      <section className="desktop-hotkeys glass-surface management" aria-label="盲盒拆信与桌面偏好">
        <h2>盲盒拆信与桌面偏好</h2>
        <p>控制界面视觉质感、单人直播「盲盒拆信模式」、提示音与启动习惯，本机自动保存，无需改动网站。</p>
        <div className="surface-picker" role="group" aria-label="界面质感与性能模式">
          <div className="surface-picker-head">
            <strong>界面质感与性能模式</strong>
            <small>
              {prefs.uiSurface === 'liquid'
                ? prefs.acrylicActive
                  ? '已开启 Windows 亚克力桌面透视 + 内部光学透镜折射'
                  : '已开启内部光学透镜折射与液态弹簧动效'
                : prefs.uiSurface === 'standard'
                  ? '已切换为标准磨砂玻璃（免重启生效）'
                  : '已切换为精简省性能模式（零模糊、零折射、零动效）'}
            </small>
          </div>
          <div className="surface-choice-grid">
            {(
              [
                ['liquid', '琉璃液态玻璃', '默认', '窗口柔雾透视 + 光学边缘折射、镜面高光与液态弹簧动效；正文卡片保持高对比清晰护眼。'],
                ['standard', '标准磨砂玻璃', '均衡', '关闭桌面透视与光学折射滤镜，保留柔和磨砂质感与轻快过渡。'],
                ['lite', '精简省性能模式', '极省 GPU', '彻底关闭模糊、透视与动效，大幅降低显卡占用，适合开大型游戏或低配电脑直播。'],
              ] as ReadonlyArray<readonly [DesktopUiSurface, string, string, string]>
            ).map(([mode, label, tag, desc]) => (
              <button
                key={mode}
                type="button"
                className="surface-choice"
                aria-pressed={prefs.uiSurface === mode}
                onClick={() => safeUpdatePrefs({ uiSurface: mode })}
              >
                <span className="surface-choice-top">
                  <span className="surface-choice-title">{label}</span>
                  <span className="surface-choice-tag">{tag}</span>
                </span>
                <span className="surface-choice-desc">{desc}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="pref-toggle">
          <span>
            <strong>启用「随机拆一封」按钮</strong>
            <small>默认关闭。开启后，盲盒拆信台面会出现「随机拆一封」按钮，可从待拆来信中随机抽取。</small>
          </span>
          <input
            type="checkbox"
            aria-label="启用随机拆一封按钮"
            checked={prefs.randomDrawEnabled}
            onChange={e => safeUpdatePrefs({ randomDrawEnabled: e.target.checked })}
          />
        </label>
        <label className="pref-toggle">
          <span>
            <strong>拆封下一封时先清空观众画面</strong>
            <small>关闭时，私下拆封新信期间观众画面继续停留在上一封；开启后，点击「拆下一封」会先清空观众画面。</small>
          </span>
          <input
            type="checkbox"
            aria-label="拆封下一封时先清空观众画面"
            checked={prefs.clearOnBlindDraw}
            onChange={e => safeUpdatePrefs({ clearOnBlindDraw: e.target.checked })}
          />
        </label>
        <label className="pref-toggle">
          <span>
            <strong>新来信风铃提示音</strong>
            <small>默认关闭。开启后，有新投稿到达时仅从私人控制台播放轻柔风铃声，绝不会进入展示窗口或 OBS 画面源。</small>
          </span>
          <input
            type="checkbox"
            aria-label="新来信风铃提示音"
            checked={prefs.chimeEnabled}
            onChange={e => {
              const next = e.target.checked;
              safeUpdatePrefs({ chimeEnabled: next });
              if (next) playWindChime(chimeVolumeDraft, true);
            }}
          />
        </label>
        {prefs.chimeEnabled ? (
          <div className="pref-inline-row">
            <label style={{ flex: 1 }}>
              {`提示音量：${chimeVolumeDraft}%`}
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={chimeVolumeDraft}
                onChange={e => {
                  const nextVol = Number(e.target.value);
                  setChimeVolumeDraft(nextVol);
                  if (chimeTimerRef.current !== null) window.clearTimeout(chimeTimerRef.current);
                  chimeTimerRef.current = window.setTimeout(() => {
                    chimeTimerRef.current = null;
                    safeUpdatePrefs({ chimeVolume: nextVol });
                  }, 120);
                }}
              />
            </label>
            <button type="button" onClick={() => playWindChime(chimeVolumeDraft, true)}>
              试听风铃声
            </button>
          </div>
        ) : null}
        <div className="pref-inline-row">
          <label style={{ flex: 1 }}>
            启动时默认打开页面
            <select
              aria-label="启动时默认打开页面"
              value={prefs.startupView}
              onChange={e => safeUpdatePrefs({ startupView: e.target.value as DesktopStartupView })}
            >
              <option value="last">记住上次离开的页面（推荐）</option>
              <option value="studio">直接进入直播工作台</option>
              <option value="inbox">默认进入收件箱</option>
            </select>
          </label>
        </div>
        <label className="pref-toggle">
          <span>
            <strong>观众端柔和进出场动效</strong>
            <small>默认开启。开启后，原生展示窗与 OBS 浏览器源切信上屏采用轻柔琉璃上浮过渡；关闭则恢复紧凑基础过渡。</small>
          </span>
          <input
            type="checkbox"
            aria-label="观众端柔和进出场动效"
            checked={prefs.displayMotion !== false}
            onChange={e => safeUpdatePrefs({ displayMotion: e.target.checked })}
          />
        </label>
        <label className="pref-toggle">
          <span>
            <strong>启动及后台自动检查新版本</strong>
            <small>优先连接国内直连镜像源，支持应用内校验并一键更新；绝不会在直播途中自动重启软件。</small>
          </span>
          <input
            type="checkbox"
            aria-label="启动时自动检查新版本"
            checked={prefs.autoCheckUpdate}
            onChange={e => safeUpdatePrefs({ autoCheckUpdate: e.target.checked })}
          />
        </label>
      </section>
    ) : null}
    <section className="desktop-hotkeys glass-surface" aria-label="直播热键">
    <h2>直播热键</h2><p>为当前话题的「下一封」与展示窗手动滚动设置全局组合键。不切窗口即可翻页；展示端未就绪时不会留下延迟任务。</p>
    <div className="desktop-hotkey-row">
      <label>下一封热键<input ref={el => { inputs.current.next = el; }} aria-label="下一封热键" value={recordingSlot === 'next' && !awaitingRelease ? '请按组合键，Esc 取消' : value} readOnly={recordingSlot === 'next'} onChange={event => setValue(event.currentTarget.value)} onKeyDown={event => record('next', event)} onKeyUp={event => void release('next', event)} onBlur={() => { if (recordingSlot === 'next') stopRecording(); }} placeholder="例如 Ctrl+Shift+N" maxLength={80} disabled={busy} /></label>
      {recordingSlot === 'next' ? (
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={stopRecording}>取消录制</button>
      ) : (
        <button type="button" onClick={() => void startRecording('next')} disabled={busy || recordingSlot !== null}>录制组合键</button>
      )}
      <button type="button" className="primary" onClick={() => void saveNext(value.trim())} disabled={busy || recordingSlot !== null || canonicalKeyCompare(value, status.nextShortcut ?? '')}>保存热键</button>
      <button type="button" onClick={() => void saveNext('')} disabled={busy || recordingSlot !== null || !(status.nextShortcut || value)}>清除热键</button>
    </div>
    {scrollRows.map(({ slot, label, placeholder }) => (
      <div className="desktop-hotkey-row" key={slot}>
        <label>{label}<input ref={el => { inputs.current[slot] = el; }} aria-label={label} value={recordingSlot === slot && !awaitingRelease ? '请按组合键，Esc 取消' : scrollValues[slot]} readOnly={recordingSlot === slot} onChange={event => setScrollValues(current => ({ ...current, [slot]: event.currentTarget.value }))} onKeyDown={event => record(slot, event)} onKeyUp={event => void release(slot, event)} onBlur={() => { if (recordingSlot === slot) stopRecording(); }} placeholder={placeholder} maxLength={80} disabled={busy} /></label>
        {recordingSlot === slot ? (
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={stopRecording}>取消录制</button>
        ) : (
          <button type="button" onClick={() => void startRecording(slot)} disabled={busy || recordingSlot !== null}>录制组合键</button>
        )}
        <button type="button" className="primary" onClick={() => void saveScroll(slot, scrollValues[slot].trim())} disabled={busy || recordingSlot !== null || canonicalKeyCompare(scrollValues[slot], scrollBasis[slot])}>保存热键</button>
        <button type="button" onClick={() => void saveScroll(slot, '')} disabled={busy || recordingSlot !== null || !(scrollBasis[slot] || scrollValues[slot])}>清除热键</button>
      </div>
    ))}
    <p>一键隐藏：<kbd>{status.shortcut}</kbd> · 下一封：<kbd>{shortcutLabel(status.nextShortcut) || '未设置'}</kbd> · 上滚：<kbd>{shortcutLabel(scrollBasis.up) || '未设置'}</kbd> · 下滚：<kbd>{shortcutLabel(scrollBasis.down) || '未设置'}</kbd> · 暂停：<kbd>{shortcutLabel(scrollBasis.pause) || '未设置'}</kbd></p>
    {awaitingRelease ? <div className="desktop-hotkey-feedback" role="status">松开所有按键后完成录制。</div> : null}
    {error || status.shortcutError || scrollError ? <div className="desktop-hotkey-error" role="alert">{error || status.shortcutError || scrollError}</div> : null}
    {notice ? <div className="desktop-hotkey-feedback" role="status">{notice}</div> : null}
  </section>
  {timelineStatus ? (
    <section className="desktop-hotkeys glass-surface management" aria-label="开播与录播时间轴自动同步">
      <div className="timeline-card-head">
        <div>
          <h2>开播 / 录播时间轴自动同步</h2>
          <p>自动对齐 OBS 推流/录制与 B站直播间真实开播起点，下播一键导出零误差 B站分段章节；全程免登录、零网站改动。</p>
        </div>
        <button type="button" disabled={timelineBusy} onClick={() => void probeTimelineNow()}>
          {timelineBusy ? '检测中…' : '🔄 立即检测同步'}
        </button>
      </div>
      <div className="timeline-status-pills">
        <span className={`obs-conn-pill${timelineStatus.obsWs.reachable ? ' is-connected' : ''}`}>
          {timelineStatus.obsWs.reachable
            ? timelineStatus.obsWs.streamActive || timelineStatus.obsWs.recordActive
              ? `OBS WebSocket 已连 · ${timelineStatus.obsWs.streamActive ? '推流中' : ''}${timelineStatus.obsWs.streamActive && timelineStatus.obsWs.recordActive ? ' / ' : ''}${timelineStatus.obsWs.recordActive ? (timelineStatus.obsWs.recordPaused ? '录制暂停' : '录制中') : ''}`
              : 'OBS WebSocket 已连 · 待机'
            : timelineStatus.obsWs.enabled
              ? 'OBS WebSocket 未开启或未运行'
              : 'OBS WebSocket 已关闭'}
        </span>
        <span className={`obs-conn-pill${timelineStatus.obsLog.detected ? ' is-ready' : ''}`}>
          {timelineStatus.obsLog.detected
            ? timelineStatus.obsLog.streamActive || timelineStatus.obsLog.recordActive
              ? 'OBS 日志 · 检测到开播/录制'
              : 'OBS 日志 · 已就绪'
            : 'OBS 日志 · 未发现近期日志'}
        </span>
        <span className={`obs-conn-pill${timelineStatus.bilibili.live ? ' is-connected' : timelineStatus.bilibili.configured ? ' is-ready' : ''}`}>
          {timelineStatus.bilibili.live
            ? `B站 #${timelineStatus.bilibili.roomId} 直播中${timelineStatus.bilibili.title ? ` · ${timelineStatus.bilibili.title}` : ''}`
            : timelineStatus.bilibili.configured
              ? `B站 #${timelineStatus.bilibili.roomId} 未开播`
              : 'B站直播间 · 未配置'}
        </span>
      </div>

      <div className="pref-inline-row">
        <label style={{ flex: 1, minWidth: 210 }}>
          B站公开直播间号（直播姬 / 全平台通用，免登录）
          <input
            type="text"
            inputMode="numeric"
            maxLength={12}
            aria-label="B站公开直播间号"
            placeholder="例如 223344（留空则不请求 B站接口）"
            value={roomInput}
            disabled={timelineBusy}
            onChange={e => setRoomInput(e.target.value.replace(/\D/g, '').slice(0, 12))}
          />
        </label>
        <button
          type="button"
          className="primary"
          disabled={timelineBusy || roomInput.trim() === timelineStatus.config.bilibiliRoomId}
          onClick={() => void applyTimelineConfig({ bilibiliRoomId: roomInput.trim() }, roomInput.trim() ? '已保存 B站直播间号并完成一次状态检测。' : '已清除 B站直播间号。')}
        >
          保存并检测
        </button>
        {timelineStatus.config.bilibiliRoomId ? (
          <button
            type="button"
            disabled={timelineBusy}
            onClick={() => {
              void applyTimelineConfig({ bilibiliRoomId: '' }, '已关闭 B站直播间号自动同步。').then(res => {
                if (res) setRoomInput('');
              });
            }}
          >
            清除
          </button>
        ) : null}
      </div>
      {timelineStatus.bilibili.error ? (
        <div className="desktop-hotkey-error" role="alert">{timelineStatus.bilibili.error}</div>
      ) : null}

      <div className="pref-inline-row">
        <label style={{ flex: 1 }}>
          OBS 同时开启推流与本地录制时，默认优先对齐
          <select
            aria-label="默认优先对齐轨道"
            value={timelineStatus.config.preferTrack}
            disabled={timelineBusy}
            onChange={e => void applyTimelineConfig({ preferTrack: e.target.value as 'stream' | 'record' }, '已更新默认时间轴对齐优先级。')}
          >
            <option value="stream">开播推流时间（推荐 · 对齐 B站云端回放）</option>
            <option value="record">本地录制时间（对齐剪映 / PR 本地录播剪辑）</option>
          </select>
        </label>
      </div>

      <label className="pref-toggle">
        <span>
          <strong>自动连接本机 OBS WebSocket v5（默认开启）</strong>
          <small>直连 127.0.0.1 获取 OBS 编码器精确毫秒时长，自动扣除本地录制暂停时间；OBS 未开启 WebSocket 时会静默跳过，绝不弹窗打扰。</small>
        </span>
        <input
          type="checkbox"
          aria-label="自动连接本机 OBS WebSocket v5"
          checked={timelineStatus.config.obsWsEnabled}
          disabled={timelineBusy}
          onChange={e => void applyTimelineConfig({ obsWsEnabled: e.target.checked })}
        />
      </label>

      {timelineStatus.config.obsWsEnabled ? (
        <div className="pref-inline-row">
          <label style={{ width: 110 }}>
            WS 端口
            <input
              type="number"
              min={1024}
              max={65535}
              aria-label="OBS WebSocket 端口"
              value={wsPortInput}
              disabled={timelineBusy}
              onChange={e => setWsPortInput(e.target.value)}
            />
          </label>
          <label style={{ flex: 1, minWidth: 180 }}>
            {timelineStatus.config.hasObsWsPassword ? '服务器密码（已加密保存，留空不修改）' : '服务器密码（OBS 未设密码可留空）'}
            <input
              type="password"
              autoComplete="off"
              aria-label="OBS WebSocket 服务器密码"
              placeholder={timelineStatus.config.hasObsWsPassword ? '••••••••（输入新密码可覆盖）' : '可选，使用 Windows 系统加密保存'}
              value={wsPasswordInput}
              disabled={timelineBusy}
              onChange={e => setWsPasswordInput(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={timelineBusy}
            onClick={() => {
              const p = Number(wsPortInput);
              if (!Number.isInteger(p) || p < 1024 || p > 65535) {
                setTimelineError('OBS WebSocket 端口需填写 1024–65535 之间的整数');
                return;
              }
              const patch: Parameters<typeof bridge.configureTimeline>[0] = { obsWsPort: p };
              if (wsPasswordInput) patch.obsWsPassword = wsPasswordInput;
              void applyTimelineConfig(patch, '已更新 OBS WebSocket 连接配置并完成测试。').then(res => {
                if (res && !res.obsWs.authError) setWsPasswordInput('');
              });
            }}
          >
            保存并测试
          </button>
          {timelineStatus.config.hasObsWsPassword ? (
            <button
              type="button"
              disabled={timelineBusy}
              onClick={() => void applyTimelineConfig({ clearObsWsPassword: true }, '已清除保存的 OBS WebSocket 密码。')}
            >
              清密码
            </button>
          ) : null}
        </div>
      ) : null}
      {timelineStatus.obsWs.authError ? (
        <div className="desktop-hotkey-error" role="alert">{timelineStatus.obsWs.authError}</div>
      ) : null}

      <label className="pref-toggle">
        <span>
          <strong>零配置监测本机 OBS 实时日志（默认开启）</strong>
          <small>仅只读解析 %APPDATA%\obs-studio\logs 最新日志里的推流/录制起止时间，即使未开 OBS WebSocket 也能毫秒级自动对齐。</small>
        </span>
        <input
          type="checkbox"
          aria-label="零配置监测本机 OBS 实时日志"
          checked={timelineStatus.config.obsLogEnabled}
          disabled={timelineBusy}
          onChange={e => void applyTimelineConfig({ obsLogEnabled: e.target.checked })}
        />
      </label>

      {timelineError ? <div className="desktop-hotkey-error" role="alert">{timelineError}</div> : null}
      {timelineNotice ? <div className="desktop-hotkey-feedback" role="status">{timelineNotice}</div> : null}
    </section>
  ) : null}
  </div>;
}
