import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WindChimeLiveCard } from '../../src/broadcast/Display';
import { LIVE_LAYOUTS, LIVE_THEMES, applyLiveTheme, type WindChimeLiveLayout, type WindChimeLiveTheme } from '../../src/broadcast/appearance';
import { DEFAULT_WINDCHIME_LIVE_APPEARANCE, type WindChimeLiveSnapshot } from '../../src/core/live';
import './gallery.css';

const sample: WindChimeLiveSnapshot = {
  id: 'design-sample', messageId: 'design-sample', nickname: '一位路过的晚风',
  text: '今天也想把一件小事说给你听。\n回家的路上，风把云吹成了一封信。\n愿你今晚有好梦，也有被认真听见的心事。',
  linkUrl: null, assets: [],
};
const photo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260" viewBox="0 0 600 260"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#7894ac"/><stop offset="1" stop-color="#d9c6b1"/></linearGradient></defs><rect width="600" height="260" fill="url(#sky)"/><circle cx="454" cy="76" r="34" fill="#f6e5bd"/><path d="M0 210 108 139 251 230 384 154 600 211V260H0" fill="#607e82"/><path d="M0 250 191 202 311 237 470 190 600 225V260H0" fill="#365b69"/></svg>');
const portraitPhoto = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><rect width="600" height="900" fill="#7894ac"/><circle cx="420" cy="175" r="78" fill="#f6e5bd"/><path d="M0 800 210 300 420 720 540 450 600 700V900H0" fill="#365b69"/><text x="300" y="865" text-anchor="middle" fill="#f6e5bd" font-size="28">风景的最下方</text></svg>');
const squarePhoto = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#baa383"/><circle cx="300" cy="250" r="150" fill="#e7d8b5"/><path d="M0 500 180 340 360 450 490 315 600 415V600H0" fill="#637d72"/></svg>');
const media = { id: 'example-photo', caption: '把此刻的风景，寄给你。', mimeType: 'image/svg+xml', width: 600, height: 260, sha256: '' };

type PreviewProps = {
  theme: WindChimeLiveTheme; layout: WindChimeLiveLayout; imageCount: number; long: boolean;
  width: number; height: number; speed: number; fontSize: number; imageHeightPercent: number; portrait: boolean; reset: number;
  imageLayout: 'row' | 'column' | 'grid';
  compact?: boolean;
};
function Preview({ theme, layout, imageCount, long, width, height, speed, fontSize, imageHeightPercent, imageLayout, portrait, reset, compact = false }: PreviewProps) {
  const container = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ scale: .5, height: height * .5 });
  const appearance = { ...applyLiveTheme(DEFAULT_WINDCHIME_LIVE_APPEARANCE, theme), layout, maxWidth: width, viewportHeight: height, scrollSpeed: speed, imageHeightPercent, fontSize, animation: 'none' as const, imageLayout };
  const assets = imageCount ? [
    { ...media, height: portrait ? 900 : media.height },
    { ...media, id: 'example-photo-2', height: portrait ? 260 : 900, caption: '第二张：不同方向的风景，也完整留在画面下方。' },
    { ...media, id: 'example-photo-3', height: 600, caption: '第三张：愿你今晚也有被认真听见的心事。' },
  ].slice(0, imageCount) : [];
  const snapshot = { ...sample, id: `design-sample-${reset}`, text: long ? (sample.text + '\n\n').repeat(8) : sample.text, assets };
  useEffect(() => {
    const update = () => {
      if (!container.current || !content.current) return;
      const scale = Math.min(1, container.current.clientWidth / width);
      setSize({ scale, height: content.current.scrollHeight * scale });
    };
    const observer = new ResizeObserver(update);
    if (container.current) observer.observe(container.current);
    if (content.current) observer.observe(content.current);
    update();
    return () => observer.disconnect();
  }, [width, height]);
  return <div ref={container} className={`design-stage${compact ? ' compact' : ''}`} data-stage-theme={theme} data-stage-layout={layout} style={{ height: size.height, maxWidth: width }}>
    <div ref={content} className="design-content" style={{ width, transform: `scale(${size.scale})` }}>
      <WindChimeLiveCard snapshot={snapshot} appearance={appearance} assetUrls={{ 'example-photo': portrait ? portraitPhoto : photo, 'example-photo-2': portrait ? photo : portraitPhoto, 'example-photo-3': squarePhoto }} />
    </div>
  </div>;
}
function App() {
  const [theme, setTheme] = useState<WindChimeLiveTheme>('uliuli');
  const [layout, setLayout] = useState<WindChimeLiveLayout>('sidebar');
  const [imageCount, setImageCount] = useState(1), [long, setLong] = useState(false);
  const [width, setWidth] = useState(360), [mode, setMode] = useState<'single' | 'matrix'>('single');
  const [height, setHeight] = useState(800), [speed, setSpeed] = useState(24), [portrait, setPortrait] = useState(false), [reset, setReset] = useState(0);
  const [imageHeightPercent, setImageHeightPercent] = useState(45), [blank, setBlank] = useState(false);
  const [imageLayout, setImageLayout] = useState<'row' | 'column' | 'grid'>('row');
  const [fontSize, setFontSize] = useState(30), [fontSizeInput, setFontSizeInput] = useState('30');
  const updateFontSize = (value: number) => {
    const next = Math.min(96, Math.max(12, Math.round(value)));
    setFontSize(next); setFontSizeInput(String(next));
  };
  const composition = LIVE_LAYOUTS.find(item => item.id === layout)!;
  const shared = { imageCount, long, speed, fontSize, portrait, imageHeightPercent, imageLayout, reset };
  return <main className="design-page" data-mode={mode}>
    <header className="design-header"><div><span className="design-eyebrow">WINDCHIME · DISPLAY STUDIES</span><h1>文字慢慢读，风景一直在。</h1><p>六种排版，三种主题。窄侧栏、竖向信笺与横向舞台，可以自由搭配。</p></div><button onClick={() => setMode(mode === 'single' ? 'matrix' : 'single')}>{mode === 'single' ? '查看十八种组合' : '返回自由搭配'}</button></header>
    <section className="design-controls" aria-label="样式选择">
      <label>视觉主题<select aria-label="视觉主题" value={theme} onChange={e => setTheme(e.target.value as WindChimeLiveTheme)}>{LIVE_THEMES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>内容排版<select aria-label="内容排版" value={layout} onChange={e => setLayout(e.target.value as WindChimeLiveLayout)}>{LIVE_LAYOUTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="design-font-size" role="group" aria-label="字体大小">
        <label htmlFor="design-font-size-number">字号 <span>12–96 px</span></label>
        <div><input type="range" aria-label="字号滑块" min={12} max={96} step={1} value={fontSize} onChange={event => updateFontSize(Number(event.currentTarget.value))} />
          <input id="design-font-size-number" type="number" aria-label="字号" min={12} max={96} step={1} value={fontSizeInput} onChange={event => {
            const raw = event.currentTarget.value, value = Number(raw);
            setFontSizeInput(raw);
            if (raw.trim() && Number.isFinite(value) && value >= 12 && value <= 96) setFontSize(Math.round(value));
          }} onBlur={() => {
            const value = Number(fontSizeInput);
            updateFontSize(fontSizeInput.trim() && Number.isFinite(value) ? value : fontSize);
          }} />
        </div>
      </div>
      <label>展示宽度<select aria-label="展示宽度" value={width} onChange={e => setWidth(Number(e.target.value))}>{[360, 480, 600, 640, 960, 1000, 1200, 1280].map(value => <option key={value} value={value}>{value} px</option>)}</select></label>
      <label>展示高度<select aria-label="展示高度" value={height} onChange={e => setHeight(Number(e.target.value))}>{[300, 360, 420, 640, 800, 860, 900].map(value => <option key={value} value={value}>{value} px</option>)}</select></label>
      <button className="design-size" onClick={() => { setWidth(composition.recommendedWidth); setHeight(composition.recommendedHeight); }}>使用推荐尺寸</button>
      <label>滚动速度<select aria-label="滚动速度" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={24}>舒缓 · 24 px/秒</option><option value={60}>中速 · 60 px/秒</option><option value={120}>快速 · 120 px/秒</option></select></label>
      <label>图片数量<select aria-label="图片数量" value={imageCount} onChange={e => setImageCount(Number(e.target.value))}><option value={0}>纯文字</option><option value={1}>1 张图片</option><option value={2}>2 张图片</option><option value={3}>3 张图片</option></select></label>
      <label>图片区域<select aria-label="图片区域" value={imageHeightPercent} onChange={e => setImageHeightPercent(Number(e.target.value))}><option value={20}>20%</option><option value={45}>45%</option><option value={60}>60%</option><option value={70}>70%</option></select></label>
      <label>图片排列<select aria-label="图片排列" value={imageLayout} onChange={e => setImageLayout(e.target.value as 'row' | 'column' | 'grid')}><option value="row">横排</option><option value="column">竖排</option><option value="grid">网格</option></select></label>
      <label className="design-check"><input type="checkbox" aria-label="长信示例" checked={long} onChange={e => setLong(e.target.checked)} />长信示例</label>
      <label className="design-check"><input type="checkbox" aria-label="竖图示例" checked={portrait} onChange={e => setPortrait(e.target.checked)} />首图使用竖图</label>
      <button onClick={() => setReset(value => value + 1)}>从头预览</button>
      <button className="design-hide" onClick={() => setBlank(!blank)}>{blank ? '恢复示例' : '隐藏示例'}</button>
    </section>
    <p className="design-note">{blank ? '画面已清空。' : '文字与图片说明自动滚动到底，停留后回顶；图片固定在下方，始终完整可见。'}<span>图片保持原比例 · 短信不滚动 · 主题与排版独立</span></p>
    {blank ? <div className="design-blank" data-blank="true" /> : mode === 'single' ? <section className="design-single"><div className="design-caption"><div><strong>{LIVE_THEMES.find(item => item.id === theme)?.name}</strong><p>{composition.description}</p></div><span>{composition.name} · {width} × {height}</span></div><Preview theme={theme} layout={layout} width={width} height={height} {...shared} /></section> : <section className="design-matrix" aria-label="主题与排版组合">{LIVE_LAYOUTS.flatMap(item => LIVE_THEMES.map(skin => <div className="design-tile" key={`${skin.id}-${item.id}`}><div className="design-tile-title"><strong>{skin.name}</strong><span>{item.name}</span></div><Preview theme={skin.id} layout={item.id} width={item.recommendedWidth} height={item.recommendedHeight} {...shared} compact /><p className="design-dimensions">{item.recommendedWidth} × {item.recommendedHeight}</p></div>))}</section>}
    <footer>纯净 / UliUli 夜航 / Mia 星祷 <span>经典信笺 · 文字双栏 · 横向条幅 · 弹幕侧栏 · 竖向信笺 · 居中短笺</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
