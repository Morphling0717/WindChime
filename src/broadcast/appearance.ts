import type { WindChimeLiveAppearance } from '../core/live.js';

export type WindChimeLiveTheme = NonNullable<WindChimeLiveAppearance['theme']>;
export type WindChimeLiveLayout = 'stack' | 'split' | 'banner' | 'sidebar' | 'portrait' | 'focus';

export const LIVE_LAYOUTS = [
  { id: 'stack', name: '经典信笺', description: '正文自然展开，适合放在直播画面的中央。', recommendedWidth: 1000, recommendedHeight: 640 },
  { id: 'split', name: '文字双栏', description: '正文分成两列，图片留在下方，适合宽幅读信。', recommendedWidth: 1200, recommendedHeight: 640 },
  { id: 'banner', name: '横向条幅', description: '称呼在左，正文向右展开，适合放在画面下方。', recommendedWidth: 1280, recommendedHeight: 360 },
  { id: 'sidebar', name: '弹幕侧栏', description: '紧凑的竖向阅读栏，像弹幕姬一样放在画面两侧。', recommendedWidth: 360, recommendedHeight: 800 },
  { id: 'portrait', name: '竖向信笺', description: '修长的单列信纸，留出呼吸感，适合竖向空间。', recommendedWidth: 480, recommendedHeight: 860 },
  { id: 'focus', name: '居中短笺', description: '居中排列称呼与正文，适合一句心意或短笺。', recommendedWidth: 600, recommendedHeight: 900 },
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
  return layout === 'split' || layout === 'banner' || layout === 'sidebar' || layout === 'portrait' || layout === 'focus' ? layout : 'stack';
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
