"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * 最小 QR 接口：兼容 npm 包 `qrcode` 的 `toCanvas` 与 `toDataURL`。
 * 宿主既可以通过 `qrcodeLib` prop 显式注入，也可依赖运行时 `import('qrcode')`。
 */
export type { QrCodeLike } from "../media/index.js";
import {
  renderWindChimeQr,
  renderWindChimePoster,
  downloadWindChimeCanvas,
  type QrCodeLike,
} from "../media/index.js";
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
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
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
  Pick<
    WindChimeQrCardTheme,
    | "root"
    | "panel"
    | "title"
    | "subtitle"
    | "canvasWrap"
    | "toolbar"
    | "button"
    | "poster"
    | "posterTitle"
    | "posterSubtitle"
    | "posterFooter"
  >
> = {
  root: "w-full max-w-sm text-slate-800 dark:text-slate-100",
  panel:
    "relative overflow-hidden rounded-[2.5rem] border border-white/40 bg-white/20 p-6 sm:p-10 shadow-[0_8px_40px_rgba(120,110,150,0.12)] backdrop-blur-2xl before:absolute before:inset-0 before:-z-10 before:bg-gradient-to-br before:from-white/60 before:via-white/10 before:to-transparent dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-100 dark:before:from-white/5 dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)]",
  title:
    "mb-1 text-xl font-bold tracking-tight bg-gradient-to-br from-violet-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-violet-300 dark:to-fuchsia-300",
  subtitle: "mb-6 text-[14px] font-medium text-slate-500 dark:text-slate-400",
  canvasWrap:
    "relative overflow-hidden rounded-[1.5rem] border border-white/30 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]",
  toolbar: "mt-5 flex flex-wrap items-center gap-3",
  button:
    "rounded-2xl border border-slate-200/80 bg-white/60 px-5 py-2.5 text-[14px] font-semibold text-slate-700 shadow-[0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-md transition hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800",
  poster: "",
  posterTitle: "",
  posterSubtitle: "",
  posterFooter: "",
};

function cn(...parts: (string | undefined | false | null)[]) {
  return parts.filter(Boolean).join(" ");
}

export function WindChimeQrCard({
  url,
  title = "给我挂风铃",
  subtitle,
  size = 320,
  foreground = "#1f2937",
  background = "#ffffff",
  margin = 2,
  errorCorrectionLevel = "H",
  logoSrc,
  logoSizeRatio = 0.2,
  logoBgColor,
  poster,
  downloadName = "windchime-qr",
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
  const renderRevision = useRef(0);

  const render = useCallback(async () => {
    const revision = ++renderRevision.current;
    setError(null);
    setReady(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      await renderWindChimeQr(canvas, {
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
      });
      if (revision === renderRevision.current) setReady(true);
    } catch (e) {
      if (revision === renderRevision.current)
        setError(e instanceof Error ? e.message : "二维码渲染失败");
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
    return () => {
      ++renderRevision.current;
    };
  }, [render]);

  const downloadQr = async () => {
    if (!canvasRef.current) return;
    try {
      await downloadWindChimeCanvas(canvasRef.current, `${downloadName}.png`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "二维码导出失败");
    }
  };
  const downloadPoster = async () => {
    if (!canvasRef.current || !poster?.enabled) return;
    try {
      const output = await renderWindChimePoster(canvasRef.current, {
        heading: "扫码给我留言",
        gradient: ["#8b5cf6", "#ec4899"],
        textColor: "#ffffff",
        ...poster,
        url,
      });
      await downloadWindChimeCanvas(output, `${downloadName}-poster.png`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "海报导出失败");
    }
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
          <p
            className="mt-2 text-xs text-red-600 dark:text-red-300"
            role="alert"
          >
            {error}
          </p>
        )}
        {showActions && (
          <div className={th.toolbar}>
            <button
              type="button"
              className={th.button}
              onClick={downloadQr}
              disabled={!ready}
            >
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

WindChimeQrCard.displayName = "WindChimeQrCard";
