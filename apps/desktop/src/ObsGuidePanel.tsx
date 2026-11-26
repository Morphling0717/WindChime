import { useState } from 'react';
import { unwrap, type ObsBridgeStatus } from './bridge';

const bridge = window.windchimeDesktop;

export function ObsGuidePanel({
  obsStatus,
  displayOpen,
  testCardActive,
  onAir,
  onToggleTestCard,
  onOpenDisplay,
  onObsChanged,
  onClose,
}: {
  obsStatus: ObsBridgeStatus;
  displayOpen: boolean;
  testCardActive: boolean;
  onAir: boolean;
  onToggleTestCard: (active: boolean) => Promise<void>;
  onOpenDisplay: () => Promise<void>;
  onObsChanged: (next: ObsBridgeStatus) => void;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<'browser' | 'window'>('browser');
  const [portInput, setPortInput] = useState(String(obsStatus.port || 17420));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const applyConfig = async (patch: { enabled?: boolean; port?: number }) => {
    setBusy(true);
    setError('');
    try {
      const next = await unwrap(bridge.configureObs(patch));
      onObsChanged(next);
      setPortInput(String(next.port || 17420));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OBS 服务配置失败');
    } finally {
      setBusy(false);
    }
  };

  const resetUrl = async () => {
    if (!(await unwrap(bridge.confirm('重置链接后，旧的 OBS 浏览器源地址会立即失效，需要在 OBS 中粘贴新链接。继续？')))) return;
    setBusy(true);
    setError('');
    try {
      const next = await unwrap(bridge.resetObsKey());
      onObsChanged(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '重置链接失败');
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    if (!obsStatus.url) return;
    try {
      await navigator.clipboard.writeText(obsStatus.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('剪贴板写入失败，请手动全选复制链接');
    }
  };

  return (
    <section className="obs-guide-card glass-surface management" aria-label="OBS 采集配置">
      <div className="obs-guide-head">
        <div>
          <h2>OBS / 直播姬采集设置</h2>
          <p>推荐使用「本机浏览器源」，无需保持展示窗打开，彻底告别黑屏、最小化遮挡与透明通道兼容问题。</p>
        </div>
        <div className="obs-guide-head-right">
          <span className={`obs-conn-pill ${obsStatus.clientCount > 0 ? 'is-connected' : obsStatus.running ? 'is-ready' : ''}`}>
            {obsStatus.clientCount > 0
              ? `OBS 浏览器源已连接（${obsStatus.clientCount}）`
              : obsStatus.running
                ? '本地服务待机中'
                : '浏览器源未开启'}
          </span>
          {onClose ? (
            <button type="button" className="obs-close-btn" onClick={onClose}>
              收起
            </button>
          ) : null}
        </div>
      </div>

      <div className="obs-mode-tabs" role="tablist" aria-label="OBS 采集方式">
        <button type="button" role="tab" aria-selected={tab === 'browser'} onClick={() => setTab('browser')}>
          方式一：本机浏览器源（推荐）
        </button>
        <button type="button" role="tab" aria-selected={tab === 'window'} onClick={() => setTab('window')}>
          方式二：独立透明窗口捕获
        </button>
      </div>

      {tab === 'browser' ? (
        <div className="obs-tab-body">
          <label className="pref-toggle">
            <span>
              <strong>启用本机 OBS 浏览器源服务（仅监听 127.0.0.1）</strong>
              <small>仅本机 OBS / 直播姬可访问，不暴露局域网、不传出网站密钥，链接固定持久化，下次开播无需重贴。</small>
            </span>
            <input
              type="checkbox"
              aria-label="启用本机 OBS 浏览器源服务"
              checked={obsStatus.enabled}
              disabled={busy}
              onChange={e => void applyConfig({ enabled: e.target.checked })}
            />
          </label>

          {obsStatus.running && obsStatus.url ? (
            <div className="obs-url-box">
              <label>
                OBS 浏览器源 URL（直接复制到 OBS → 来源 → 浏览器）
                <div className="obs-url-row">
                  <input type="text" readOnly value={obsStatus.url} aria-label="OBS 浏览器源地址" onFocus={e => e.currentTarget.select()} />
                  <button type="button" className="primary" onClick={() => void copyUrl()}>
                    {copied ? '已复制 ✓' : '复制链接'}
                  </button>
                  <button type="button" disabled={busy} onClick={() => void resetUrl()}>
                    重置链接
                  </button>
                </div>
              </label>
              <div className="obs-port-row">
                <label>
                  本机端口
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={portInput}
                    disabled={busy}
                    onChange={e => setPortInput(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || Number(portInput) === obsStatus.port}
                  onClick={() => void applyConfig({ enabled: true, port: Number(portInput) })}
                >
                  应用端口
                </button>
                <button
                  type="button"
                  disabled={busy || Boolean(onAir && !testCardActive)}
                  onClick={() => void onToggleTestCard(!testCardActive).catch(() => {})}
                >
                  {testCardActive ? '关闭 OBS 测试卡' : '发测试卡对位 OBS'}
                </button>
              </div>
              <ol className="obs-steps">
                <li>在 OBS 点击「来源 +」→ 选择「浏览器」，粘贴上方 URL。</li>
                <li>宽高填你在「设置与外观 → 展示外观」设定的展示宽度与高度（默认 <code>1200 × 640</code>），确定即可。</li>
                <li>点击「发测试卡对位 OBS」即可实时拖放对位；一键隐藏（<code>Ctrl+Shift+H</code>）会毫秒级清空 OBS 画面。</li>
              </ol>
            </div>
          ) : (
            <p className="obs-hint">开启上方开关后会自动生成专属本机地址，无需打开独立窗口就能在 OBS 里直接出画面。</p>
          )}
        </div>
      ) : (
        <div className="obs-tab-body">
          <ol className="obs-steps">
            <li>点击下方按钮打开独立透明窗口 <code>WindChime Display</code>（下次重开会自动记住你上次拖放的位置）。</li>
            <li>在 OBS 点击「来源 +」→「窗口捕获」→ 窗口选择 <code>WindChime Display</code>。</li>
            <li><strong>若出现黑屏或透明底异常</strong>：将捕获方式改为 <code>Windows 10 (1903 及以上)</code>（WGC），并取消勾选「捕获光标」；窗口不可最小化，可移到副屏或后台遮挡。</li>
          </ol>
          <div className="obs-actions-row">
            <button type="button" className="primary" onClick={() => void onOpenDisplay()}>
              {displayOpen ? '查看独立展示窗口' : '打开独立展示窗口'}
            </button>
            <button
              type="button"
              disabled={busy || Boolean(onAir && !testCardActive)}
              onClick={() => void onToggleTestCard(!testCardActive).catch(() => {})}
            >
              {testCardActive ? '关闭测试卡' : '发测试卡对位 OBS'}
            </button>
          </div>
        </div>
      )}

      {error || obsStatus.error ? (
        <p className="desktop-hotkey-error" role="alert">
          {error || obsStatus.error}
        </p>
      ) : null}
    </section>
  );
}
