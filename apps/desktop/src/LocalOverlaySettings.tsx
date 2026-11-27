import { useEffect, useRef, useState } from 'react';
import { unwrap, type DesktopOverlayState } from './bridge';

const bridge = window.windchimeDesktop;

const POSITIONS = [
  ['top-left', '左上角'],
  ['top-right', '右上角'],
  ['bottom-left', '左下角'],
  ['bottom-right', '右下角'],
] as const;

export function LocalOverlaySettings({
  overlay,
  onChange,
}: {
  overlay: DesktopOverlayState;
  onChange: (next: DesktopOverlayState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [watermark, setWatermark] = useState(overlay.watermarkText);
  const syncedWatermarkRef = useRef(overlay.watermarkText);
  const [sliderDraft, setSliderDraft] = useState({
    badgeSize: overlay.badgeSize,
    badgeOpacity: overlay.badgeOpacity,
    backgroundOpacity: overlay.backgroundOpacity,
  });
  const pendingPatchRef = useRef<Partial<DesktopOverlayState>>({});
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (overlay.watermarkText !== syncedWatermarkRef.current) {
      const wasClean = watermark === syncedWatermarkRef.current;
      syncedWatermarkRef.current = overlay.watermarkText;
      if (wasClean) setWatermark(overlay.watermarkText);
    }
  }, [overlay.watermarkText, watermark]);

  useEffect(() => {
    setSliderDraft({
      badgeSize: overlay.badgeSize,
      badgeOpacity: overlay.badgeOpacity,
      backgroundOpacity: overlay.backgroundOpacity,
    });
  }, [overlay.badgeSize, overlay.badgeOpacity, overlay.backgroundOpacity]);

  useEffect(() => () => {
    if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
  }, []);

  const patch = async (input: Partial<DesktopOverlayState>) => {
    setError('');
    try {
      const next = await unwrap(bridge.setOverlay(input));
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存本机装饰失败');
    }
  };

  const patchSlider = (key: 'badgeSize' | 'badgeOpacity' | 'backgroundOpacity', value: number) => {
    setSliderDraft(cur => ({ ...cur, [key]: value }));
    onChange({ ...overlay, [key]: value });
    pendingPatchRef.current = { ...pendingPatchRef.current, [key]: value };
    if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      const queued = pendingPatchRef.current;
      pendingPatchRef.current = {};
      if (Object.keys(queued).length) void patch(queued);
    }, 150);
  };

  const pick = async (slot: 'badge' | 'background') => {
    setBusy(true);
    setError('');
    try {
      const next = await unwrap(bridge.pickOverlayImage(slot));
      if (next) onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '选择图片失败');
    } finally {
      setBusy(false);
    }
  };

  const clear = async (slot: 'badge' | 'background') => {
    setBusy(true);
    setError('');
    try {
      const next = await unwrap(bridge.clearOverlayImage(slot));
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '清除图片失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="desktop-hotkeys glass-surface management local-overlay-panel" aria-label="本机展示装饰与水印">
      <h2>本机自定义装饰与水印（仅本机生效）</h2>
      <p>为观众展示卡片叠加你的专属 Q 版角标、频道文字水印或半透明底图。图片仅保存在本机，不上传网站，同步生效于原生展示窗与 OBS 浏览器源。</p>

      <label className="pref-toggle">
        <span>
          <strong>启用本机装饰叠层</strong>
          <small>开启后可在上方外观预览、测试卡与正式播出的卡片上实时看到叠加效果。</small>
        </span>
        <input
          type="checkbox"
          aria-label="启用本机装饰叠层"
          checked={overlay.enabled}
          onChange={e => void patch({ enabled: e.target.checked })}
        />
      </label>

      <div className="overlay-grid">
        <div className="overlay-slot">
          <strong>角落头像 / 立绘角标</strong>
          <div className="overlay-slot-actions">
            <button type="button" disabled={busy} onClick={() => void pick('badge')}>
              {overlay.hasBadge ? '更换角标图片' : '上传角标图片'}
            </button>
            {overlay.hasBadge ? (
              <button type="button" disabled={busy} onClick={() => void clear('badge')}>
                移除角标
              </button>
            ) : null}
          </div>
          {overlay.badgeUrl ? <img className="overlay-thumb" src={overlay.badgeUrl} alt="当前角标预览" /> : null}
        </div>

        <div className="overlay-slot">
          <strong>卡片背景叠图（可选）</strong>
          <div className="overlay-slot-actions">
            <button type="button" disabled={busy} onClick={() => void pick('background')}>
              {overlay.hasBackground ? '更换背景叠图' : '上传背景叠图'}
            </button>
            {overlay.hasBackground ? (
              <button type="button" disabled={busy} onClick={() => void clear('background')}>
                移除背景图
              </button>
            ) : null}
          </div>
          {overlay.backgroundUrl ? <img className="overlay-thumb is-bg" src={overlay.backgroundUrl} alt="当前背景叠图预览" /> : null}
        </div>
      </div>

      <div className="overlay-controls">
        <label>
          角标位置
          <div className="overlay-pos-group" role="group" aria-label="角标位置">
            {POSITIONS.map(([pos, label]) => (
              <button
                key={pos}
                type="button"
                aria-pressed={overlay.badgePosition === pos}
                onClick={() => void patch({ badgePosition: pos })}
              >
                {label}
              </button>
            ))}
          </div>
        </label>

        <label>
          频道文字水印（最多 40 字，留空不显示）
          <div className="obs-url-row">
            <input
              type="text"
              maxLength={40}
              value={watermark}
              placeholder="例如：@你的直播间昵称 · 匿名提问箱"
              onChange={e => setWatermark(e.target.value)}
            />
            <button
              type="button"
              disabled={watermark.trim() === overlay.watermarkText}
              onClick={() => void patch({ watermarkText: watermark.trim() })}
            >
              保存水印
            </button>
          </div>
        </label>

        <div className="overlay-sliders">
          <label>
            {`角标大小：${sliderDraft.badgeSize}px`}
            <input
              type="range"
              min={32}
              max={128}
              step={4}
              value={sliderDraft.badgeSize}
              onChange={e => patchSlider('badgeSize', Number(e.target.value))}
            />
          </label>
          <label>
            {`角标 / 水印不透明度：${sliderDraft.badgeOpacity}%`}
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={sliderDraft.badgeOpacity}
              onChange={e => patchSlider('badgeOpacity', Number(e.target.value))}
            />
          </label>
          <label>
            {`背景叠图不透明度：${sliderDraft.backgroundOpacity}%`}
            <input
              type="range"
              min={0}
              max={80}
              step={5}
              value={sliderDraft.backgroundOpacity}
              onChange={e => patchSlider('backgroundOpacity', Number(e.target.value))}
            />
          </label>
        </div>
      </div>

      {error ? (
        <p className="desktop-hotkey-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
