import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { shortcutLabel, unwrap, type DesktopStatus } from './bridge';

const bridge = window.windchimeDesktop;
function accelerator(event: KeyboardEvent<HTMLInputElement>) {
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code) ? event.code : ({ ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Space: 'Space', Enter: 'Enter', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete' } as Record<string, string>)[event.code];
  return key ? [event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Super' : '', key].filter(Boolean).join('+') : null;
}

export function Hotkeys({ status, onSaved }: { status: DesktopStatus; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(status.nextShortcut ?? '');
  const [basis, setBasis] = useState(status.nextShortcut ?? '');
  const [recording, setRecording] = useState(false);
  const [awaitingRelease, setAwaitingRelease] = useState(false);
  const captured = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => { if (value === basis && status.nextShortcut !== basis) { setValue(status.nextShortcut ?? ''); setBasis(status.nextShortcut ?? ''); } }, [status.nextShortcut, value, basis]);
  useEffect(() => {
    alive.current = true;
    const stop = () => { captured.current = false; setAwaitingRelease(false); setRecording(false); void unwrap(bridge.setShortcutRecording(false)).catch(() => {}); };
    window.addEventListener('blur', stop);
    return () => { alive.current = false; window.removeEventListener('blur', stop); void unwrap(bridge.setShortcutRecording(false)).catch(() => {}); };
  }, []);
  useEffect(() => { if (!recording) return; const timeout = setTimeout(() => { captured.current = false; setAwaitingRelease(false); setRecording(false); void unwrap(bridge.setShortcutRecording(false)).catch(() => {}); }, 25000); return () => clearTimeout(timeout); }, [recording]);
  const startRecording = async () => {
    setError(''); setNotice('');
    try { await unwrap(bridge.setShortcutRecording(true)); if (alive.current) { captured.current = false; setAwaitingRelease(false); setRecording(true); input.current?.focus(); } }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '无法录制热键'); }
  };
  const record = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!recording) return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat || captured.current) return;
    if (event.key !== 'Escape') { const result = accelerator(event); if (!result) return; setValue(result); }
    captured.current = true; setAwaitingRelease(true);
  };
  const release = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (!recording || !captured.current || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    event.preventDefault();
    captured.current = false; setAwaitingRelease(false);
    setRecording(false);
    try { await unwrap(bridge.setShortcutRecording(false)); }
    catch (e) { setError(e instanceof Error ? e.message : '无法恢复热键'); }
  };
  const save = async (candidate: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice(''); setRecording(false);
    try {
      await unwrap(bridge.setShortcutRecording(false));
      await unwrap(bridge.setNextShortcut(candidate));
      if (alive.current) { setValue(candidate); setBasis(candidate); setNotice(candidate ? '下一封热键已保存，切到其他窗口也可使用。' : '已关闭下一封热键。'); }
      await onSaved();
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '热键保存失败'); }
    finally { if (alive.current) setBusy(false); }
  };
  return <section className="desktop-hotkeys glass-surface" aria-label="直播热键">
    <h2>直播热键</h2><p>为当前话题的「下一封」设置组合键。仅切换已批准来信；展示端未就绪时不会留下延迟播放任务。</p>
    <div className="desktop-hotkey-row">
      <label>下一封热键<input ref={input} aria-label="下一封热键" value={recording && !awaitingRelease ? '请按组合键，Esc 取消' : value} readOnly={recording} onChange={event => setValue(event.currentTarget.value)} onKeyDown={record} onKeyUp={event => void release(event)} placeholder="例如 Ctrl+Shift+N" maxLength={80} disabled={busy} /></label>
      <button onClick={() => void startRecording()} disabled={busy || recording}>录制组合键</button>
      <button className="primary" onClick={() => void save(value.trim())} disabled={busy || recording || value.trim() === (status.nextShortcut ?? '')}>保存热键</button>
      <button onClick={() => void save('')} disabled={busy || recording || !(status.nextShortcut || value)}>清除热键</button>
    </div>
    <p>一键隐藏：<kbd>{status.shortcut}</kbd> · 下一封当前设置：<kbd>{shortcutLabel(status.nextShortcut) || '未设置'}</kbd></p>
    {awaitingRelease ? <div className="desktop-hotkey-feedback" role="status">松开所有按键后完成录制。</div> : null}
    {error || status.shortcutError ? <div className="desktop-hotkey-error" role="alert">{error || status.shortcutError}</div> : null}
    {notice ? <div className="desktop-hotkey-feedback" role="status">{notice}</div> : null}
  </section>;
}
