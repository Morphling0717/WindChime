import { useEffect, useRef, useState } from 'react';
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
  const [sizeWidth, setSizeWidth] = useState('1000');
  const [sizeHeight, setSizeHeight] = useState('640');
  const [sizeFeedback, setSizeFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const syncedPortRef = useRef(String(obsStatus.port || 17420));
  const copyTimerRef = useRef<number | null>(null);
  const sizeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const nextPort = String(obsStatus.port || 17420);
    if (nextPort !== syncedPortRef.current) {
      syncedPortRef.current = nextPort;
      setPortInput(nextPort);
    }
  }, [obsStatus.port]);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    if (sizeTimerRef.current !== null) window.clearTimeout(sizeTimerRef.current);
  }, []);

  const applyDisplaySize = async (w: number, h: number) => {
    setBusy(true);
    setError('');
    setSizeFeedback('');
    try {
      const next = await unwrap(bridge.setDisplaySize({ width: w, height: h }));
      setSizeWidth(String(next.width));
      setSizeHeight(String(next.height));
      setSizeFeedback(
        displayOpen
          ? `已应用窗口尺寸 ${next.width} × ${next.height} px。`
          : `已预设窗口尺寸 ${next.width} × ${next.height} px，打开独立展示窗口后立即生效。`,
      );
      if (sizeTimerRef.current !== null) window.clearTimeout(sizeTimerRef.current);
      sizeTimerRef.current = window.setTimeout(() => {
        setSizeFeedback('');
        sizeTimerRef.current = null;
      }, 3200);
    } catch (e) {
      setError(e instanceof Error ? e.message : '调整展示尺寸失败');
    } finally {
      setBusy(false);
    }
  };

  const applyConfig = async (patch: { enabled?: boolean; port?: number }) => {
    if (patch.port !== undefined) {
      if (!Number.isInteger(patch.port) || patch.port < 1024 || patch.port > 65535) {
        setError('本机端口需填写 1024–65535 之间的整数');
        return;
      }
    }
    setBusy(true);
    setError('');
    try {
      const next = await unwrap(bridge.configureObs(patch));
      onObsChanged(next);
      const resolvedPort = String(next.port || 17420);
      syncedPortRef.current = resolvedPort;
      setPortInput(resolvedPort);
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
    setError('');
    try {
      await unwrap(bridge.writeClipboard(obsStatus.url));
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 2000);
    } catch {
      setError('剪贴板写入失败，请手动全选复制链接');
    }
  };

  const parsedPort = portInput.trim() === '' ? NaN : Number(portInput.trim());
  const portValid = Number.isInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535;
  const showPortControls = obsStatus.running || obsStatus.enabled || Boolean(obsStatus.error);

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
              <small>已默认开启，仅本机 OBS / 直播姬可访问，不暴露局域网、不传出网站密钥，链接固定持久化，下次开播无需重贴。</small>
            </span>
            <input
              type="checkbox"
              aria-label="启用本机 OBS 浏览器源服务"
              checked={obsStatus.enabled}
              disabled={busy}
              onChange={e => void applyConfig({ enabled: e.target.checked })}
            />
          </label>

          {showPortControls ? (
            <div className="obs-url-box">
              {obsStatus.running && obsStatus.url ? (
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
              ) : null}
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
                  disabled={busy || !portValid || (obsStatus.running && parsedPort === obsStatus.port)}
                  onClick={() => void applyConfig({ enabled: true, port: parsedPort })}
                >
                  {obsStatus.running ? '应用端口' : '更换端口并重试'}
                </button>
                {obsStatus.running && obsStatus.url ? (
                  <button
                    type="button"
                    disabled={busy || Boolean(onAir && !testCardActive)}
                    onClick={() => void onToggleTestCard(!testCardActive).catch(() => {})}
                  >
                    {testCardActive ? '关闭 OBS 测试卡' : '发测试卡对位 OBS'}
                  </button>
                ) : null}
              </div>
              {obsStatus.running && obsStatus.url ? (
                <ol className="obs-steps">
                  <li>在 OBS 点击「来源 +」→ 选择「浏览器」，粘贴上方 URL。</li>
                  <li><strong>自由调整形状（拉长 / 拉宽 / 改竖屏）</strong>：在 OBS 双击该浏览器源，直接填你想要的「宽度 / 高度」（例如竖屏 <code>480 × 860</code>、横屏 <code>1000 × 640</code>、横幅 <code>1280 × 360</code>），风铃卡片会自动 <strong>100% 铺满整个画布</strong>且文字绝不变形。</li>
                  <li>点击「发测试卡对位 OBS」会显示四边虚线框与实时像素尺寸，在 OBS 预览区拖红框四角即可等比缩放与定位；一键隐藏（<code>Ctrl+Shift+H</code>）会毫秒级清空 OBS 画面。</li>
                </ol>
              ) : null}
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
          <div className="obs-port-row" style={{ marginTop: 10 }}>
            <button type="button" disabled={busy} onClick={() => void applyDisplaySize(1000, 640)}>横屏 1000×640</button>
            <button type="button" disabled={busy} onClick={() => void applyDisplaySize(480, 860)}>长竖屏 480×860</button>
            <button type="button" disabled={busy} onClick={() => void applyDisplaySize(360, 800)}>窄侧栏 360×800</button>
            <button type="button" disabled={busy} onClick={() => void applyDisplaySize(1280, 360)}>宽条幅 1280×360</button>
          </div>
          <div className="obs-port-row" style={{ marginTop: 8 }}>
            <label>
              窗口宽度
              <input type="number" min={280} max={1920} value={sizeWidth} disabled={busy} onChange={e => setSizeWidth(e.target.value)} />
            </label>
            <label>
              窗口高度
              <input type="number" min={180} max={1080} value={sizeHeight} disabled={busy} onChange={e => setSizeHeight(e.target.value)} />
            </label>
            <button type="button" disabled={busy} onClick={() => void applyDisplaySize(Number(sizeWidth) || 1000, Number(sizeHeight) || 640)}>
              应用窗口尺寸
            </button>
          </div>
          {sizeFeedback ? (
            <p className="desktop-hotkey-feedback" role="status">
              {sizeFeedback}
            </p>
          ) : null}
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
