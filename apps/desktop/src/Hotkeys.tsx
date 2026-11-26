import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { shortcutLabel, unwrap, type DesktopStatus, type ScrollShortcuts } from './bridge';

const bridge = window.windchimeDesktop;
function accelerator(event: KeyboardEvent<HTMLInputElement>) {
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code) ? event.code : ({ ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Space: 'Space', Enter: 'Enter', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete' } as Record<string, string>)[event.code];
  return key ? [event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Super' : '', key].filter(Boolean).join('+') : null;
}

type Slot = 'next' | 'up' | 'down' | 'pause';

export function Hotkeys({ status, onSaved }: { status: DesktopStatus; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(status.nextShortcut ?? '');
  const [basis, setBasis] = useState(status.nextShortcut ?? '');
  const [scrollValues, setScrollValues] = useState<ScrollShortcuts>({ up: '', down: '', pause: '' });
  const [scrollBasis, setScrollBasis] = useState<ScrollShortcuts>({ up: '', down: '', pause: '' });
  const [scrollError, setScrollError] = useState('');
  const [recordingSlot, setRecordingSlot] = useState<Slot | null>(null);
  const [awaitingRelease, setAwaitingRelease] = useState(false);
  const captured = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputs = useRef<Record<Slot, HTMLInputElement | null>>({ next: null, up: null, down: null, pause: null });
  const alive = useRef(true);

  useEffect(() => {
    void unwrap(bridge.getScrollShortcuts()).then(result => {
      if (!alive.current) return;
      const clean = { up: result.up ?? '', down: result.down ?? '', pause: result.pause ?? '' };
      setScrollValues(clean);
      setScrollBasis(clean);
      setScrollError(result.error ?? '');
    }).catch(() => {});
  }, []);

  useEffect(() => { if (value === basis && status.nextShortcut !== basis) { setValue(status.nextShortcut ?? ''); setBasis(status.nextShortcut ?? ''); } }, [status.nextShortcut, value, basis]);
  useEffect(() => {
    alive.current = true;
    const stop = () => { captured.current = false; setAwaitingRelease(false); setRecordingSlot(null); void unwrap(bridge.setShortcutRecording(false)).catch(() => {}); };
    window.addEventListener('blur', stop);
    return () => { alive.current = false; window.removeEventListener('blur', stop); void unwrap(bridge.setShortcutRecording(false)).catch(() => {}); };
  }, []);
  useEffect(() => { if (!recordingSlot) return; const timeout = setTimeout(() => { captured.current = false; setAwaitingRelease(false); setRecordingSlot(null); void unwrap(bridge.setShortcutRecording(false)).catch(() => {}); }, 25000); return () => clearTimeout(timeout); }, [recordingSlot]);

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
    if (event.key !== 'Escape') {
      const result = accelerator(event);
      if (!result) return;
      if (slot === 'next') setValue(result);
      else setScrollValues(current => ({ ...current, [slot]: result }));
    }
    captured.current = true; setAwaitingRelease(true);
  };

  const release = async (slot: Slot, event: KeyboardEvent<HTMLInputElement>) => {
    if (recordingSlot !== slot || !captured.current || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    event.preventDefault();
    captured.current = false; setAwaitingRelease(false);
    setRecordingSlot(null);
    try { await unwrap(bridge.setShortcutRecording(false)); }
    catch (e) { setError(e instanceof Error ? e.message : '无法恢复热键'); }
  };

  const saveNext = async (candidate: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice(''); setRecordingSlot(null);
    try {
      await unwrap(bridge.setShortcutRecording(false));
      await unwrap(bridge.setNextShortcut(candidate));
      if (alive.current) { setValue(candidate); setBasis(candidate); setNotice(candidate ? '下一封热键已保存，切到其他窗口也可使用。' : '已关闭下一封热键。'); }
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
        const clean = { up: updated.up ?? '', down: updated.down ?? '', pause: updated.pause ?? '' };
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

  return <section className="desktop-hotkeys glass-surface" aria-label="直播热键">
    <h2>直播热键</h2><p>为当前话题的「下一封」与展示窗手动滚动设置全局组合键。不切窗口即可翻页；展示端未就绪时不会留下延迟任务。</p>
    <div className="desktop-hotkey-row">
      <label>下一封热键<input ref={el => { inputs.current.next = el; }} aria-label="下一封热键" value={recordingSlot === 'next' && !awaitingRelease ? '请按组合键，Esc 取消' : value} readOnly={recordingSlot === 'next'} onChange={event => setValue(event.currentTarget.value)} onKeyDown={event => record('next', event)} onKeyUp={event => void release('next', event)} placeholder="例如 Ctrl+Shift+N" maxLength={80} disabled={busy} /></label>
      <button onClick={() => void startRecording('next')} disabled={busy || recordingSlot !== null}>录制组合键</button>
      <button className="primary" onClick={() => void saveNext(value.trim())} disabled={busy || recordingSlot !== null || value.trim() === (status.nextShortcut ?? '')}>保存热键</button>
      <button onClick={() => void saveNext('')} disabled={busy || recordingSlot !== null || !(status.nextShortcut || value)}>清除热键</button>
    </div>
    {scrollRows.map(({ slot, label, placeholder }) => (
      <div className="desktop-hotkey-row" key={slot}>
        <label>{label}<input ref={el => { inputs.current[slot] = el; }} aria-label={label} value={recordingSlot === slot && !awaitingRelease ? '请按组合键，Esc 取消' : scrollValues[slot]} readOnly={recordingSlot === slot} onChange={event => setScrollValues(current => ({ ...current, [slot]: event.currentTarget.value }))} onKeyDown={event => record(slot, event)} onKeyUp={event => void release(slot, event)} placeholder={placeholder} maxLength={80} disabled={busy} /></label>
        <button onClick={() => void startRecording(slot)} disabled={busy || recordingSlot !== null}>录制组合键</button>
        <button className="primary" onClick={() => void saveScroll(slot, scrollValues[slot].trim())} disabled={busy || recordingSlot !== null || scrollValues[slot].trim() === scrollBasis[slot]}>保存热键</button>
        <button onClick={() => void saveScroll(slot, '')} disabled={busy || recordingSlot !== null || !(scrollBasis[slot] || scrollValues[slot])}>清除热键</button>
      </div>
    ))}
    <p>一键隐藏：<kbd>{status.shortcut}</kbd> · 下一封：<kbd>{shortcutLabel(status.nextShortcut) || '未设置'}</kbd> · 上滚：<kbd>{shortcutLabel(scrollBasis.up) || '未设置'}</kbd> · 下滚：<kbd>{shortcutLabel(scrollBasis.down) || '未设置'}</kbd> · 暂停：<kbd>{shortcutLabel(scrollBasis.pause) || '未设置'}</kbd></p>
    {awaitingRelease ? <div className="desktop-hotkey-feedback" role="status">松开所有按键后完成录制。</div> : null}
    {error || status.shortcutError || scrollError ? <div className="desktop-hotkey-error" role="alert">{error || status.shortcutError || scrollError}</div> : null}
    {notice ? <div className="desktop-hotkey-feedback" role="status">{notice}</div> : null}
  </section>;
}
