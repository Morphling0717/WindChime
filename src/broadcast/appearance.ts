import type { WindChimeLiveAppearance } from '../core/live.js';

export type WindChimeLiveTheme = NonNullable<WindChimeLiveAppearance['theme']>;
export type WindChimeLiveLayout = 'stack' | 'split' | 'banner';

export const LIVE_LAYOUTS = [
  { id: 'stack', name: '纵向信笺', description: '称呼、正文与图片从上到下，适合慢慢读信。' },
  { id: 'split', name: '图文双栏', description: '文字与图片并排；纯文字来信分为两栏。' },
  { id: 'banner', name: '横向条幅', description: '称呼在左，正文向右展开，适合放在画面下方。' },
] as const;

export const LIVE_THEMES = [
  { id: 'pure', name: '纯净', description: '透明、无装饰，让文字留在画面里。' },
  { id: 'uliuli', name: 'UliUli · 夜航', description: '深夜蓝黑、霓虹青与轻盈的信号线。' },
  { id: 'mia', name: 'Mia · 星祷', description: '奶油信纸、香槟金与柔和的拱窗。' },
] as const;

export const LIVE_THEME_FONTS = {
  pure: 'system-ui',
  uliuli: '"Segoe UI", "Microsoft YaHei", sans-serif',
  mia: '"Noto Serif SC", "Songti SC", SimSun, serif',
} as const;

/** Legacy layout values remain readable without adding theme choices to layout. */
export function resolveLiveLayout(layout: WindChimeLiveAppearance['layout']): WindChimeLiveLayout {
  return layout === 'split' || layout === 'banner' ? layout : 'stack';
}

/** A skin preserves explicit sizing, composition, media order and animation settings. */
export function applyLiveTheme(appearance: WindChimeLiveAppearance, theme: WindChimeLiveTheme): WindChimeLiveAppearance {
  const skin = {
    pure: { textColor: '#ffffff', backgroundColor: '#18202eee', accentColor: '#2de2e6', transparent: true, borderWidth: 0, borderRadius: 24 },
    uliuli: { textColor: '#e9fcff', backgroundColor: '#050508ee', accentColor: '#2de2e6', transparent: false, borderWidth: 1, borderRadius: 18 },
    mia: { textColor: '#2b2620', backgroundColor: '#fbf6ec', accentColor: '#c4a96e', transparent: false, borderWidth: 1, borderRadius: 20 },
  }[theme];
  return { ...appearance, ...skin, theme, fontFamily: LIVE_THEME_FONTS[theme] };
}
