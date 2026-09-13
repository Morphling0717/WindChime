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
const media = { id: 'example-photo', caption: '把此刻的风景，寄给你。', mimeType: 'image/svg+xml', width: 600, height: 260, sha256: '' };

function Preview({ theme, layout, images, long, width, compact = false }: { theme: WindChimeLiveTheme; layout: WindChimeLiveLayout; images: boolean; long: boolean; width: number; compact?: boolean }) {
  const container = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ scale: .5, height: 300 });
  const appearance = { ...applyLiveTheme(DEFAULT_WINDCHIME_LIVE_APPEARANCE, theme), layout, maxWidth: width, fontSize: 30, animation: 'none' as const, imageLayout: 'row' as const };
  const snapshot = { ...sample, text: long ? (sample.text + '\n\n').repeat(12) : sample.text, assets: images ? [media] : [] };
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
  }, [width]);
  return <div ref={container} className={`design-stage${compact ? ' compact' : ''}`} data-stage-theme={theme} data-stage-layout={layout} style={{ height: size.height }}>
    <div ref={content} className="design-content" style={{ width, transform: `scale(${size.scale})` }}>
      <WindChimeLiveCard snapshot={snapshot} appearance={appearance} assetUrls={{ 'example-photo': photo }} />
    </div>
  </div>;
}
function App() {
  const [theme, setTheme] = useState<WindChimeLiveTheme>('uliuli');
  const [layout, setLayout] = useState<WindChimeLiveLayout>('stack');
  const [images, setImages] = useState(false), [long, setLong] = useState(false);
  const [width, setWidth] = useState(960), [mode, setMode] = useState<'single' | 'matrix'>('single');
  const [blank, setBlank] = useState(false);
  return <main className="design-page" data-mode={mode}>
    <header className="design-header"><div><span className="design-eyebrow">WINDCHIME · DISPLAY STUDIES</span><h1>同一封来信，不同的模样。</h1><p>排版安排内容，主题赋予颜色与质感。它们可以自由搭配。</p></div><button onClick={() => setMode(mode === 'single' ? 'matrix' : 'single')}>{mode === 'single' ? '查看九种组合' : '返回自由搭配'}</button></header>
    <section className="design-controls" aria-label="样式选择">
      <label>视觉主题<select aria-label="视觉主题" value={theme} onChange={e => setTheme(e.target.value as WindChimeLiveTheme)}>{LIVE_THEMES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>内容排版<select aria-label="内容排版" value={layout} onChange={e => setLayout(e.target.value as WindChimeLiveLayout)}>{LIVE_LAYOUTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>展示宽度<select aria-label="展示宽度" value={width} onChange={e => setWidth(Number(e.target.value))}><option value={960}>宽 · 960 px</option><option value={640}>中 · 640 px</option><option value={360}>窄 · 360 px</option></select></label>
      <label className="design-check"><input type="checkbox" aria-label="包含图片" checked={images} onChange={e => setImages(e.target.checked)} />包含图片</label>
      <label className="design-check"><input type="checkbox" aria-label="长信示例" checked={long} onChange={e => setLong(e.target.checked)} />长信示例</label>
      <button className="design-hide" onClick={() => setBlank(!blank)}>{blank ? '恢复示例' : '隐藏示例'}</button>
    </section>
    <p className="design-note">{blank ? '画面已清空。' : '示例预览 · 不连接信箱，也不会播出。棋盘格表示透明区域。'}<span>主题变化不会改变当前排版。</span></p>
    {blank ? <div className="design-blank" data-blank="true" /> : mode === 'single' ? <section className="design-single"><div className="design-caption"><div><strong>{LIVE_THEMES.find(item => item.id === theme)?.name}</strong><p>{LIVE_THEMES.find(item => item.id === theme)?.description}</p></div><span>{LIVE_LAYOUTS.find(item => item.id === layout)?.name}</span></div><Preview theme={theme} layout={layout} images={images} long={long} width={width} /></section> : <section className="design-matrix" aria-label="主题与排版组合">{LIVE_THEMES.flatMap(skin => LIVE_LAYOUTS.map(composition => <div className="design-tile" key={`${skin.id}-${composition.id}`}><div className="design-tile-title"><strong>{skin.name}</strong><span>{composition.name}</span></div><Preview theme={skin.id} layout={composition.id} images={images} long={long} width={960} compact /></div>))}</section>}
    <footer>纯净 / UliUli 夜航 / Mia 星祷 <span>纵向信笺 · 图文双栏 · 横向条幅</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
