'use client';
import { useEffect, useRef, useState } from 'react';
import type { WindChimeLiveAppearance, WindChimeLiveSnapshot } from '../core/live.js';
import type { useWindChimeLiveControl } from '../react/live.js';
import { LIVE_LAYOUTS, LIVE_THEMES, LIVE_THEME_FONTS, applyLiveTheme, resolveLiveLayout } from './appearance.js';
import { WindChimeLiveCard } from './Display.js';
import { windChimeAppearanceEditorCss } from './appearance-editor-styles.js';

type Studio = ReturnType<typeof useWindChimeLiveControl>;
const SAMPLE_ASSETS = [
  { id: 'appearance-sample-day', caption: '山间晴日', mimeType: 'image/svg+xml', width: 280, height: 140, sha256: '' },
  { id: 'appearance-sample-night', caption: '月下微风', mimeType: 'image/svg+xml', width: 280, height: 140, sha256: '' },
];
const SAMPLE_URLS = {
  'appearance-sample-day': `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="280" height="140" viewBox="0 0 280 140"><rect width="280" height="140" fill="#dde9df"/><circle cx="219" cy="37" r="19" fill="#eabf72"/><path d="M0 128 69 46 144 131 206 70 280 140H0" fill="#6c9890"/><path d="m0 140 84-45 83 30 75-18 38 33" fill="#315d5c"/></svg>')}`,
  'appearance-sample-night': `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="280" height="140" viewBox="0 0 280 140"><rect width="280" height="140" fill="#293c54"/><circle cx="66" cy="37" r="17" fill="#e2dbb5"/><circle cx="73" cy="30" r="16" fill="#293c54"/><path d="M0 132 65 89 109 118 184 64 280 124V140H0" fill="#527382"/><path d="M0 140V128L68 112l72 20 90-34 50 29v13" fill="#91aaa3"/><g fill="#e2dbb5"><circle cx="136" cy="27" r="1.5"/><circle cx="217" cy="42" r="2"/><circle cx="176" cy="16" r="1"/></g></svg>')}`,
};
const FONT_OPTIONS = [
  { value: 'system-ui', label: '系统字体' },
  { value: LIVE_THEME_FONTS.uliuli, label: 'Uliuli · 清晰黑体' },
  { value: LIVE_THEME_FONTS.mia, label: 'Mia · 书卷宋体' },
  { value: 'sans-serif', label: '无衬线字体' },
  { value: 'serif', label: '衬线字体' },
  { value: 'monospace', label: '等宽字体' },
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'SimSun', label: '宋体' },
];

function NumberField({ label, value, min, max, step = 1, unit = 'px', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void;
}) {
  return <label className="wc-appearance-field">{label}<span className="wc-appearance-number">
    <input type="number" aria-label={label} min={min} max={max} step={step} required value={value} onChange={event => {
      const next = Number(event.target.value);
      if (event.target.value.trim() && Number.isFinite(next)) onChange(next);
    }} />{unit ? <span className="wc-appearance-unit" aria-hidden="true">{unit}</span> : null}
  </span></label>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="wc-appearance-field"><span>{label}</span><span className="wc-appearance-color">
    <input type="color" aria-label={label} value={value.slice(0, 7)} onChange={event => onChange(event.currentTarget.value + (value.length === 9 ? value.slice(7) : ''))} />
    <span className="wc-appearance-color-value" aria-hidden="true">{value.slice(0, 7).toUpperCase()}</span>
  </span></label>;
}

function AppearancePreview({ appearance }: { appearance: WindChimeLiveAppearance }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(512);
  const [withImages, setWithImages] = useState(true);
  const [longLetter, setLongLetter] = useState(false);
  const [lightCanvas, setLightCanvas] = useState(false);
  const verticalLayout = ['sidebar', 'portrait', 'focus'].includes(resolveLiveLayout(appearance.layout));
  const canvasWidth = Math.max(verticalLayout ? 440 : 1280, (appearance.maxWidth ?? 1200) + 80);
  const canvasHeight = Math.max(canvasWidth * 9 / 16, (appearance.viewportHeight ?? 640) + 80);
  const scale = previewWidth / canvasWidth;
  const viewportHeight = canvasHeight * scale;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (!width) return;
      setPreviewWidth(element.clientWidth || width);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', measure);
    element.addEventListener?.('load', measure, true);
    return () => { window.removeEventListener('resize', measure); element.removeEventListener?.('load', measure, true); };
  }, []);
  const snapshot: WindChimeLiveSnapshot = {
    id: 'appearance-private-sample', messageId: 'appearance-private-sample',
    nickname: '来自山间的风', text: '把今天的小小快乐，寄给此刻的你。\n愿每一封来信，都在这里得到温柔的回应。\n'.repeat(longLetter ? 12 : 1).trim(), linkUrl: null,
    assets: withImages ? SAMPLE_ASSETS : [],
  };
  return <section className="wc-appearance-preview" aria-label="外观私下预览">
    <div className="wc-appearance-preview-head"><strong>即时预览</strong><span className="wc-appearance-caption">示例内容 · 不参与播出</span></div>
    <div ref={viewport} className={`wc-appearance-viewport${lightCanvas ? ' wc-appearance-viewport-light' : ''}`} style={{ height: viewportHeight }} aria-label="固定视窗来信预览">
      <div className="wc-appearance-scroll-space" style={{ height: canvasHeight * scale }}>
        <div className="wc-appearance-canvas" style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${scale})` }}>
          <div className="wc-appearance-preview-content">
            <WindChimeLiveCard key={appearance.animation} snapshot={snapshot} appearance={appearance} assetUrls={SAMPLE_URLS} />
          </div>
        </div>
      </div>
    </div>
    <div className="wc-appearance-preview-options">
      <label className="wc-appearance-check"><input type="checkbox" checked={withImages} onChange={event => setWithImages(event.currentTarget.checked)} />预览示例图片</label>
      <label className="wc-appearance-check"><input type="checkbox" checked={longLetter} onChange={event => setLongLetter(event.currentTarget.checked)} />预览长信循环</label>
      <div className="wc-appearance-canvas-options" role="group" aria-label="预览画布颜色">
        <button type="button" aria-pressed={!lightCanvas} onClick={() => setLightCanvas(false)}>深色画布</button>
        <button type="button" aria-pressed={lightCanvas} onClick={() => setLightCanvas(true)}>浅色画布</button>
      </div>
      <span className="wc-appearance-caption">等比例固定视窗 · 与播出相同</span>
    </div>
  </section>;
}

export function AppearanceEditor({ studio, onDirtyChange }: { studio: Studio; onDirtyChange: (dirty: boolean) => void }) {
  const form = useRef<HTMLFormElement>(null);
  const [appearance, setAppearance] = useState(studio.state!.appearance);
  const [basis, setBasis] = useState(studio.state!.appearance);
  const canSaveAppearance = studio.state!.appearance.theme !== undefined && studio.state!.appearance.imageHeightPercent !== undefined;
  const dirty = JSON.stringify(appearance) !== JSON.stringify(basis);
  const conflict = JSON.stringify(studio.state!.appearance) !== JSON.stringify(basis);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    if (!dirty && conflict) { setAppearance(studio.state!.appearance); setBasis(studio.state!.appearance); }
  }, [dirty, conflict, studio.state!.appearance]);
  const save = async () => {
    if (studio.pending || !studio.connected || conflict || !canSaveAppearance) return;
    const submitted = structuredClone(appearance);
    const result = await studio.actWithResult({ action: 'appearance', appearance: submitted });
    if (result) {
      setBasis(result.appearance);
      setAppearance(before => JSON.stringify(before) === JSON.stringify(submitted) ? result.appearance : before);
    }
  };
  const change = <K extends keyof WindChimeLiveAppearance>(key: K, value: WindChimeLiveAppearance[K]) => setAppearance(before => ({ ...before, [key]: value }));
  const selectedTheme = appearance.theme ?? 'pure';
  const selectedLayout = LIVE_LAYOUTS.find(layout => layout.id === resolveLiveLayout(appearance.layout))!;
  return <form ref={form} className="wc-appearance-editor" onSubmit={event => { event.preventDefault(); void save(); }} onInvalid={event => {
    const details = (event.target as HTMLElement).closest('details');
    if (details) details.open = true;
  }}>
    <style>{windChimeAppearanceEditorCss}</style>
    <AppearancePreview appearance={appearance} />
    <p className="wc-appearance-caption">调整会立即显示在这里，点击「应用外观」后同步到观众画面。</p>

    <fieldset className="wc-appearance-section">
      <legend>界面主题</legend><p className="wc-appearance-section-note">选择配色与装饰风格，排版保持不变。</p>
      <div className="wc-appearance-choices">
        {LIVE_THEMES.map(theme => <button key={theme.id} type="button" className="wc-appearance-choice" aria-pressed={selectedTheme === theme.id} onClick={() => setAppearance(before => applyLiveTheme(before, theme.id))}>
          <span className={`wc-appearance-theme-sample wc-appearance-theme-${theme.id}`} aria-hidden="true"><span className="wc-appearance-sample-eyebrow">{theme.id === 'uliuli' ? 'LIVE MAIL' : theme.id === 'mia' ? '一封来信' : '轻轻，读一封信'}</span><span className="wc-appearance-sample-text">风铃来信</span><span className="wc-appearance-sample-line" /></span>
          <span className="wc-appearance-choice-name">{theme.name}<span className="wc-appearance-selected" aria-hidden="true">{selectedTheme === theme.id ? '✓' : ''}</span></span>
          <span className="wc-appearance-choice-note">{theme.description}</span>
        </button>)}
      </div>
    </fieldset>

    <fieldset className="wc-appearance-section">
      <legend>内容排版</legend><p className="wc-appearance-section-note">决定文字的阅读方式，可搭配任意主题。图片始终固定在文字下方。</p>
      <div className="wc-appearance-choices">
        {LIVE_LAYOUTS.map(layout => <button key={layout.id} type="button" className="wc-appearance-choice wc-appearance-layout-choice" aria-pressed={resolveLiveLayout(appearance.layout) === layout.id} onClick={() => change('layout', layout.id)}>
          <span className={`wc-appearance-layout-sample wc-appearance-layout-${layout.id}`} aria-hidden="true"><span className="wc-appearance-layout-copy"><i /><i /><i /></span><span className="wc-appearance-layout-image" /></span>
          <span className="wc-appearance-choice-name">{layout.name}<span className="wc-appearance-selected" aria-hidden="true">{resolveLiveLayout(appearance.layout) === layout.id ? '✓' : ''}</span></span>
          <span className="wc-appearance-choice-note">{layout.description}</span>
        </button>)}
      </div>
      <div className="wc-appearance-recommended-size">
        <span>推荐尺寸 <strong>{selectedLayout.recommendedWidth} × {selectedLayout.recommendedHeight}</strong><span className="wc-appearance-caption">选择排版会保留当前尺寸</span></span>
        <button type="button" onClick={() => setAppearance(before => ({ ...before, maxWidth: selectedLayout.recommendedWidth, viewportHeight: selectedLayout.recommendedHeight }))}>使用推荐尺寸</button>
      </div>
    </fieldset>

    <fieldset className="wc-appearance-section">
      <legend>文字与配色</legend>
      <div className="wc-appearance-fields wc-appearance-type-fields">
        <label className="wc-appearance-field">字体<select value={appearance.fontFamily} onChange={event => change('fontFamily', event.target.value)}>
          {FONT_OPTIONS.some(font => font.value === appearance.fontFamily) ? null : <option value={appearance.fontFamily}>{appearance.fontFamily}</option>}
          {FONT_OPTIONS.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}
        </select></label>
        <NumberField label="字号" value={appearance.fontSize} min={12} max={96} onChange={value => change('fontSize', value)} />
      </div>
      <div className="wc-appearance-fields wc-appearance-colors">
        <ColorField label="背景颜色" value={appearance.backgroundColor} onChange={value => change('backgroundColor', value)} />
        <ColorField label="文字颜色" value={appearance.textColor} onChange={value => change('textColor', value)} />
        <ColorField label="强调颜色" value={appearance.accentColor ?? '#2de2e6'} onChange={value => change('accentColor', value)} />
      </div>
      <label className="wc-appearance-check wc-appearance-transparency"><input type="checkbox" checked={appearance.transparent} onChange={event => change('transparent', event.currentTarget.checked)} /><span><strong>透明背景</strong><span className="wc-appearance-caption">让直播画面透过来信背景</span></span></label>
    </fieldset>

    <fieldset className="wc-appearance-section">
      <legend>展示视窗与长信</legend>
      <p className="wc-appearance-section-note">长信只有文字滚动到底，停留后回到顶部。图片保持原比例，固定显示在下方；仅循环当前来信，不切换下一封。</p>
      <div className="wc-appearance-fields">
        <NumberField label="展示高度" value={appearance.viewportHeight ?? 640} min={180} max={1080} onChange={value => change('viewportHeight', value)} />
        <NumberField label="图片区域占比" value={appearance.imageHeightPercent ?? 45} min={20} max={70} unit="%" onChange={value => change('imageHeightPercent', value)} />
        <NumberField label="滚动速度" value={appearance.scrollSpeed ?? 24} min={5} max={120} unit="px/秒" onChange={value => change('scrollSpeed', value)} />
        <NumberField label="顶部停留" value={appearance.scrollStartPauseMs ?? 2000} min={0} max={15000} step={100} unit="ms" onChange={value => change('scrollStartPauseMs', value)} />
        <NumberField label="底部停留" value={appearance.scrollEndPauseMs ?? 2500} min={0} max={15000} step={100} unit="ms" onChange={value => change('scrollEndPauseMs', value)} />
      </div>
      <p className="wc-appearance-caption">图片占比调整下方图片区域的高度；较矮的窗口会自动为文字留出空间。没有图片时，文字使用完整空间。</p>
      <label className="wc-appearance-check"><input type="checkbox" checked={appearance.autoScroll ?? true} onChange={event => change('autoScroll', event.currentTarget.checked)} />长信自动循环滚动</label>
      {appearance.autoScroll === false ? <p className="wc-appearance-caption">已关闭滚动：超出视窗的内容不会显示，请缩小字号或增大展示高度。</p> : null}
    </fieldset>

    <details className="wc-appearance-advanced">
      <summary><span>高级设置</span><span className="wc-appearance-caption">间距、边框、图片与动画</span></summary>
      <div className="wc-appearance-advanced-content">
        <fieldset className="wc-appearance-section">
          <legend>阅读间距</legend><div className="wc-appearance-fields">
            <NumberField label="行高" value={appearance.lineHeight ?? 1.65} min={1.1} max={2.4} step={0.05} unit="倍" onChange={value => change('lineHeight', value)} />
            <NumberField label="字距" value={appearance.letterSpacing ?? 0} min={-1} max={6} step={0.1} onChange={value => change('letterSpacing', value)} />
            <NumberField label="内边距" value={appearance.padding} min={0} max={100} onChange={value => change('padding', value)} />
            <NumberField label="最大宽度" value={appearance.maxWidth ?? 1200} min={280} max={1920} onChange={value => change('maxWidth', value)} />
          </div>
        </fieldset>
        <fieldset className="wc-appearance-section">
          <legend>边框与圆角</legend><div className="wc-appearance-fields">
            <NumberField label="圆角" value={appearance.borderRadius} min={0} max={100} onChange={value => change('borderRadius', value)} />
            <NumberField label="边框粗细" value={appearance.borderWidth ?? 0} min={0} max={8} step={0.5} onChange={value => change('borderWidth', value)} />
          </div>
        </fieldset>
        <fieldset className="wc-appearance-section">
          <legend>图片与动效</legend><div className="wc-appearance-fields">
            <label className="wc-appearance-field"><span>图片排列</span><select value={appearance.imageLayout ?? 'column'} onChange={event => change('imageLayout', event.currentTarget.value as WindChimeLiveAppearance['imageLayout'])}><option value="row">横向排列</option><option value="column">纵向排列</option><option value="grid">网格排列</option></select></label>
            <label className="wc-appearance-field"><span>入场动画</span><select value={appearance.animation} onChange={event => change('animation', event.currentTarget.value as WindChimeLiveAppearance['animation'])}><option value="none">无</option><option value="fade">淡入</option><option value="slide">上移</option></select></label>
          </div>
        </fieldset>
      </div>
    </details>

    {dirty && conflict ? <div className="wc-appearance-conflict" role="alert"><strong>外观已在另一控制端更新，你的改动仍保留。</strong><div className="wc-appearance-conflict-actions"><button type="button" onClick={() => { setAppearance(studio.state!.appearance); setBasis(studio.state!.appearance); }}>载入最新外观，放弃本地改动</button><button type="button" onClick={() => setBasis(studio.state!.appearance)}>确认新外观，保留我的编辑</button></div></div> : null}
    {!canSaveAppearance ? <p className="wc-appearance-upgrade" role="status">此网站需要升级到风铃 0.8.0 才能保存新版外观。现在可以先预览。</p> : null}
    <div className="wc-appearance-save"><span className="wc-appearance-save-state" role="status"><i className={dirty ? 'wc-appearance-dirty' : 'wc-appearance-synced'} />{dirty ? '有未应用的外观调整' : '外观已同步'}</span><button type="submit" className="wc-appearance-apply wc-primary" disabled={studio.pending || !studio.connected || conflict || !canSaveAppearance} onClick={event => {
      event?.preventDefault();
      if (!form.current || form.current.reportValidity()) void save();
    }}>应用外观</button></div>
  </form>;
}
