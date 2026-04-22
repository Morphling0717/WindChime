'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * 最小 QR 接口：兼容 npm 包 `qrcode` 的 `toCanvas` 与 `toDataURL`。
 * 宿主既可以通过 `qrcodeLib` prop 显式注入，也可依赖运行时 `import('qrcode')`。
 */
export type QrCodeLike = {
  toCanvas: (
    canvas: HTMLCanvasElement,
    text: string,
    opts?: {
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
      margin?: number;
      width?: number;
      color?: { dark?: string; light?: string };
    },
  ) => Promise<void>;
  toDataURL?: (text: string, opts?: unknown) => Promise<string>;
};

export type WindChimeQrCardTheme = {
  root?: string;
  panel?: string;
  title?: string;
  subtitle?: string;
  canvasWrap?: string;
  toolbar?: string;
  button?: string;
  /** 海报外层（仅海报模式） */
  poster?: string;
  posterTitle?: string;
  posterSubtitle?: string;
  posterFooter?: string;
};

export type WindChimeQrCardProps = {
  /** 要编码的 URL/文本；必填 */
  url: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** 画布像素；实际会 devicePixelRatio 放大 */
  size?: number;
  /** 前景色（模块色），默认 `#1f2937` */
  foreground?: string;
  /** 背景色，默认 `#ffffff` */
  background?: string;
  /** quiet zone（模块单位），默认 2 */
  margin?: number;
  /** 纠错级别，默认 `H`（可嵌入更大 Logo） */
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  /** 中心 Logo 源（URL / dataURL），跨域源需 CORS 许可 */
  logoSrc?: string;
  /** Logo 占画布宽度比例，默认 0.2 */
  logoSizeRatio?: number;
  /** Logo 四周留白圆角背景色；默认与 `background` 相同 */
  logoBgColor?: string;
  /** 海报模式 */
  poster?: {
    enabled?: boolean;
    heading?: string;
    body?: string;
    footer?: string;
    /** 海报纵向画布宽度（px），默认 900 */
    width?: number;
    /** 海报背景渐变 [起色, 止色]，默认紫粉；当提供 `backgroundImageSrc` 时仍会作为加载失败的 fallback 底色 */
    gradient?: [string, string];
    /** 海报背景图 URL（建议同源或带 CORS）。加载成功后按 cover 方式铺满画布 */
    backgroundImageSrc?: string;
    /** 背景图不透明度 0~1，默认 1 */
    backgroundImageOpacity?: number;
    /** 背景图之上叠加的半透明覆盖色，用于保证文字可读；默认 `rgba(0,0,0,0.38)` */
    backgroundImageOverlay?: string;
    textColor?: string;
    /** 顶部圆形头像 URL（需 CORS 允许或同源） */
    avatarSrc?: string;
    /** 头像直径占海报宽度的比例，默认 0.22 */
    avatarSizeRatio?: number;
    /** 头像圆环描边颜色，默认白色半透明 */
    avatarRingColor?: string;
  };
  /** 下载文件名前缀，默认 `windchime-qr` */
  downloadName?: string;
  /** 注入 qrcode 库实例；不传则动态 `import('qrcode')` */
  qrcodeLib?: QrCodeLike;
  theme?: WindChimeQrCardTheme;
  className?: string;
  /** 是否展示下载按钮，默认 true */
  showActions?: boolean;
};

const defaults: Required<
  Pick<WindChimeQrCardTheme, 'root' | 'panel' | 'title' | 'subtitle' | 'canvasWrap' | 'toolbar' | 'button' | 'poster' | 'posterTitle' | 'posterSubtitle' | 'posterFooter'>
> = {
  root: 'w-full max-w-sm text-slate-800 dark:text-slate-100',
  panel:
    'relative overflow-hidden rounded-[2.5rem] border border-white/40 bg-white/20 p-6 sm:p-10 shadow-[0_8px_40px_rgba(120,110,150,0.12)] backdrop-blur-2xl before:absolute before:inset-0 before:-z-10 before:bg-gradient-to-br before:from-white/60 before:via-white/10 before:to-transparent dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-100 dark:before:from-white/5 dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)]',
  title: 'mb-1 text-xl font-bold tracking-tight bg-gradient-to-br from-violet-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-violet-300 dark:to-fuchsia-300',
  subtitle: 'mb-6 text-[14px] font-medium text-slate-500 dark:text-slate-400',
  canvasWrap: 'relative overflow-hidden rounded-[1.5rem] border border-white/30 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]',
  toolbar: 'mt-5 flex flex-wrap items-center gap-3',
  button:
    'rounded-2xl border border-slate-200/80 bg-white/60 px-5 py-2.5 text-[14px] font-semibold text-slate-700 shadow-[0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-md transition hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800',
  poster: '',
  posterTitle: '',
  posterSubtitle: '',
  posterFooter: '',
};

function cn(...parts: (string | undefined | false | null)[]) {
  return parts.filter(Boolean).join(' ');
}

async function loadQrCode(lib?: QrCodeLike): Promise<QrCodeLike> {
  if (lib) return lib;
  try {
    // 静态字面量，交给宿主打包器做代码分割；TS 侧由 `declare module 'qrcode'` 兜底。
    const mod = (await import('qrcode')) as QrCodeLike | { default: QrCodeLike };
    return 'toCanvas' in mod ? (mod as QrCodeLike) : (mod as { default: QrCodeLike }).default;
  } catch {
    throw new Error(
      '缺少二维码依赖：请在宿主安装 `qrcode`（npm i qrcode）或通过 props.qrcodeLib 注入。',
    );
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Logo 加载失败'));
    img.src = src;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function WindChimeQrCard({
  url,
  title = '给我挂风铃',
  subtitle,
  size = 320,
  foreground = '#1f2937',
  background = '#ffffff',
  margin = 2,
  errorCorrectionLevel = 'H',
  logoSrc,
  logoSizeRatio = 0.2,
  logoBgColor,
  poster,
  downloadName = 'windchime-qr',
  qrcodeLib,
  theme,
  className,
  showActions = true,
}: WindChimeQrCardProps) {
  const th = useMemo(
    () => ({
      root: theme?.root ?? defaults.root,
      panel: theme?.panel ?? defaults.panel,
      title: theme?.title ?? defaults.title,
      subtitle: theme?.subtitle ?? defaults.subtitle,
      canvasWrap: theme?.canvasWrap ?? defaults.canvasWrap,
      toolbar: theme?.toolbar ?? defaults.toolbar,
      button: theme?.button ?? defaults.button,
      poster: theme?.poster ?? defaults.poster,
      posterTitle: theme?.posterTitle ?? defaults.posterTitle,
      posterSubtitle: theme?.posterSubtitle ?? defaults.posterSubtitle,
      posterFooter: theme?.posterFooter ?? defaults.posterFooter,
    }),
    [theme],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const render = useCallback(async () => {
    setError(null);
    setReady(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const qr = await loadQrCode(qrcodeLib);
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const px = Math.round(size * dpr);
      await qr.toCanvas(canvas, url, {
        errorCorrectionLevel,
        margin,
        width: px,
        color: { dark: foreground, light: background },
      });
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;

      if (logoSrc) {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 不可用');
        const img = await loadImage(logoSrc);
        const logoPx = Math.round(px * logoSizeRatio);
        const bgPad = Math.round(logoPx * 0.12);
        const total = logoPx + bgPad * 2;
        const x = Math.round((px - total) / 2);
        const y = Math.round((px - total) / 2);
        // 圆角白底
        const r = Math.round(total * 0.18);
        ctx.fillStyle = logoBgColor ?? background;
        roundRect(ctx, x, y, total, total, r);
        ctx.fill();
        ctx.drawImage(img, x + bgPad, y + bgPad, logoPx, logoPx);
      }

      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '二维码渲染失败');
    }
  }, [
    url,
    size,
    foreground,
    background,
    margin,
    errorCorrectionLevel,
    logoSrc,
    logoSizeRatio,
    logoBgColor,
    qrcodeLib,
  ]);

  useEffect(() => {
    void render();
  }, [render]);

  const downloadQr = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${downloadName}.png`;
      link.click();
      URL.revokeObjectURL(link.href);
    }, 'image/png');
  };

  const downloadPoster = async () => {
    const qrCanvas = canvasRef.current;
    if (!qrCanvas || !poster?.enabled) return;
    const W = poster.width ?? 900;
    const H = Math.round(W * 1.55);
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');
    if (!ctx) return;

    // 渐变背景（始终绘制，作为背景图加载失败时的 fallback）
    const [g1, g2] = poster.gradient ?? ['#8b5cf6', '#ec4899'];
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, g1);
    grad.addColorStop(1, g2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 背景图（cover 缩放 + 覆盖层）
    let bgImageDrawn = false;
    if (poster.backgroundImageSrc) {
      try {
        const bg = await loadImage(poster.backgroundImageSrc);
        const bgAlpha = Math.min(
          1,
          Math.max(0, poster.backgroundImageOpacity ?? 1),
        );
        const scale = Math.max(W / bg.width, H / bg.height);
        const dw = bg.width * scale;
        const dh = bg.height * scale;
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;
        ctx.save();
        ctx.globalAlpha = bgAlpha;
        ctx.drawImage(bg, dx, dy, dw, dh);
        ctx.restore();
        const overlay = poster.backgroundImageOverlay ?? 'rgba(0,0,0,0.38)';
        ctx.fillStyle = overlay;
        ctx.fillRect(0, 0, W, H);
        bgImageDrawn = true;
      } catch {
        /* 加载失败则保持纯渐变 + 柔光圆 */
      }
    }

    // 柔光圆（仅无背景图时绘制，避免和背景图打架）
    if (!bgImageDrawn) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(W * 0.85, H * 0.08, W * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(W * 0.1, H * 0.92, W * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }

    const textColor = poster.textColor ?? '#ffffff';

    // 头像（圆形 + 光晕 + 白色描边）
    let cursorY = W * 0.08;
    if (poster.avatarSrc) {
      try {
        const avatar = await loadImage(poster.avatarSrc);
        const aSize = Math.round(W * (poster.avatarSizeRatio ?? 0.22));
        const ax = W / 2;
        const ay = cursorY + aSize / 2;
        // 外光晕
        const halo = ctx.createRadialGradient(ax, ay, aSize * 0.48, ax, ay, aSize * 0.95);
        halo.addColorStop(0, 'rgba(255,255,255,0.45)');
        halo.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(ax, ay, aSize * 0.95, 0, Math.PI * 2);
        ctx.fill();
        // 白环
        ctx.fillStyle = poster.avatarRingColor ?? 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(ax, ay, aSize / 2 + Math.round(W * 0.012), 0, Math.PI * 2);
        ctx.fill();
        // 头像裁圆
        ctx.save();
        ctx.beginPath();
        ctx.arc(ax, ay, aSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, ax - aSize / 2, ay - aSize / 2, aSize, aSize);
        ctx.restore();
        cursorY = ay + aSize / 2 + W * 0.045;
      } catch {
        // 头像加载失败就跳过
        cursorY = W * 0.1;
      }
    } else {
      cursorY = W * 0.12;
    }

    // 标题
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${Math.round(W * 0.075)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
    const heading = poster.heading ?? '扫码给我留言';
    ctx.fillText(heading, W / 2, cursorY + W * 0.06);
    cursorY += W * 0.08;

    // 副标题
    if (poster.body) {
      ctx.font = `400 ${Math.round(W * 0.036)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      const lines = wrapText(ctx, poster.body, W * 0.78);
      for (const line of lines) {
        cursorY += W * 0.052;
        ctx.fillText(line, W / 2, cursorY);
      }
      cursorY += W * 0.02;
    }

    // QR 白底卡片
    const cardSize = Math.round(W * 0.58);
    const cardX = (W - cardSize) / 2;
    const cardY = cursorY + W * 0.05;
    // 卡片阴影
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, cardX, cardY, cardSize, cardSize, 32);
    ctx.fill();
    ctx.restore();
    // 将 QR canvas 缩放绘制到卡片内（留内边距）
    const inner = Math.round(cardSize * 0.86);
    const innerX = cardX + (cardSize - inner) / 2;
    const innerY = cardY + (cardSize - inner) / 2;
    ctx.drawImage(qrCanvas, innerX, innerY, inner, inner);

    // 落款
    ctx.fillStyle = textColor;
    ctx.font = `600 ${Math.round(W * 0.034)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
    ctx.fillText(poster.footer ?? url, W / 2, cardY + cardSize + W * 0.075);
    ctx.font = `400 ${Math.round(W * 0.026)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('🎐 WindChime 匿名提问箱', W / 2, H - W * 0.045);

    await new Promise<void>((resolve) => {
      out.toBlob((blob) => {
        if (blob) {
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `${downloadName}-poster.png`;
          link.click();
          URL.revokeObjectURL(link.href);
        }
        resolve();
      }, 'image/png');
    });
  };

  return (
    <div className={cn(th.root, className)} data-widget="windchime-qr">
      <div className={th.panel}>
        {title && <div className={th.title}>{title}</div>}
        {subtitle && <div className={th.subtitle}>{subtitle}</div>}
        <div className={th.canvasWrap}>
          <canvas ref={canvasRef} aria-label="二维码" />
        </div>
        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-300" role="alert">
            {error}
          </p>
        )}
        {showActions && (
          <div className={th.toolbar}>
            <button type="button" className={th.button} onClick={downloadQr} disabled={!ready}>
              下载二维码
            </button>
            {poster?.enabled && (
              <button
                type="button"
                className={th.button}
                onClick={() => void downloadPoster()}
                disabled={!ready}
              >
                下载海报
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

WindChimeQrCard.displayName = 'WindChimeQrCard';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
