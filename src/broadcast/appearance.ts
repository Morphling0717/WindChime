import type { WindChimeLiveAppearance } from '../core/live.js';

export type WindChimeLiveTheme = NonNullable<WindChimeLiveAppearance['theme']>;
export type WindChimeLiveLayout = 'stack' | 'split' | 'banner' | 'sidebar' | 'portrait' | 'focus';

export const LIVE_LAYOUTS = [
  { id: 'stack', name: '经典信笺', description: '单列正文，适合放在画面中央。', recommendedWidth: 1000, recommendedHeight: 640 },
  { id: 'split', name: '文字双栏', description: '正文分为两列，适合宽屏区域。', recommendedWidth: 1200, recommendedHeight: 640 },
  { id: 'banner', name: '横向条幅', description: '昵称在左、正文在右，适合放在画面下方。', recommendedWidth: 1280, recommendedHeight: 360 },
  { id: 'sidebar', name: '弹幕侧栏', description: '窄幅竖向排版，适合放在画面两侧。', recommendedWidth: 360, recommendedHeight: 800 },
  { id: 'portrait', name: '竖向信笺', description: '单列正文，适合竖向区域。', recommendedWidth: 480, recommendedHeight: 860 },
  { id: 'focus', name: '居中短笺', description: '昵称与正文居中，适合短消息。', recommendedWidth: 600, recommendedHeight: 900 },
] as const;

export const LIVE_THEMES = [
  { id: 'pure', name: '纯净', description: '透明背景，无边框装饰。' },
  { id: 'uliuli', name: 'UliUli · 夜航', description: '蓝黑背景、青色线条。' },
  { id: 'mia', name: 'Mia · 星祷', description: '米色背景、金色边框。' },
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

/** Keep the private preview and audience viewport on the same finite bounds. */
export function resolveLiveViewportSize(appearance: Pick<WindChimeLiveAppearance, 'maxWidth' | 'viewportHeight'>) {
  return {
    width: Number.isFinite(appearance.maxWidth) ? Math.min(1920, Math.max(280, appearance.maxWidth!)) : 1200,
    height: Number.isFinite(appearance.viewportHeight) ? Math.min(1080, Math.max(180, appearance.viewportHeight!)) : 640,
  };
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
