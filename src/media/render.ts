export type QrCodeLike = {
  toCanvas: (
    canvas: HTMLCanvasElement,
    text: string,
    opts?: {
      errorCorrectionLevel?: "L" | "M" | "Q" | "H";
      margin?: number;
      width?: number;
      color?: { dark?: string; light?: string };
    },
  ) => Promise<void>;
  toDataURL?: (text: string, opts?: unknown) => Promise<string>;
};

export type WindChimeQrOptions = {
  url: string;
  size?: number;
  foreground?: string;
  background?: string;
  margin?: number;
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  logoSrc?: string;
  logoSizeRatio?: number;
  logoBgColor?: string;
  qrcodeLib?: QrCodeLike;
  pixelRatio?: number;
};
export type WindChimePosterOptions = {
  url: string;
  width?: number;
  heading?: string;
  body?: string;
  footer?: string;
  gradient?: [string, string];
  backgroundImageSrc?: string;
  backgroundImageOpacity?: number;
  backgroundImageOverlay?: string;
  textColor?: string;
  avatarSrc?: string;
  avatarSizeRatio?: number;
  avatarRingColor?: string;
  brandingText?: string;
};
async function loadQrCode(lib?: QrCodeLike): Promise<QrCodeLike> {
  if (lib) return lib;
  try {
    // 静态字面量，交给宿主打包器做代码分割；TS 侧由 `declare module 'qrcode'` 兜底。
    const mod = (await import("qrcode")) as
      QrCodeLike | { default: QrCodeLike };
    return "toCanvas" in mod
      ? (mod as QrCodeLike)
      : (mod as { default: QrCodeLike }).default;
  } catch {
    throw new Error("QRCODE_DEPENDENCY_REQUIRED");
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
    img.src = src;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let cur = "";
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

const renders = new WeakMap<HTMLCanvasElement, number>();
/** Renders offscreen before copying so stale image/library promises cannot overwrite a newer QR. */
export async function renderWindChimeQr(
  canvas: HTMLCanvasElement,
  options: WindChimeQrOptions,
): Promise<void> {
  const generation = (renders.get(canvas) ?? 0) + 1;
  renders.set(canvas, generation);
  const {
    url,
    size = 320,
    foreground = "#1f2937",
    background = "#ffffff",
    margin = 2,
    errorCorrectionLevel = "H",
    logoSrc,
    logoSizeRatio = 0.2,
    logoBgColor,
    qrcodeLib,
  } = options;
  const qr = await loadQrCode(qrcodeLib);
  const px = Math.round(
    size *
      (options.pixelRatio ??
        (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1)),
  );
  const output = document.createElement("canvas");
  await qr.toCanvas(output, url, {
    errorCorrectionLevel,
    margin,
    width: px,
    color: { dark: foreground, light: background },
  });
  if (logoSrc) {
    const ctx = output.getContext("2d");
    if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
    const img = await loadImage(logoSrc);
    const logoPx = Math.round(px * logoSizeRatio),
      bgPad = Math.round(logoPx * 0.12),
      total = logoPx + bgPad * 2;
    const x = Math.round((px - total) / 2),
      y = Math.round((px - total) / 2);
    ctx.fillStyle = logoBgColor ?? background;
    roundRect(ctx, x, y, total, total, Math.round(total * 0.18));
    ctx.fill();
    ctx.drawImage(img, x + bgPad, y + bgPad, logoPx, logoPx);
  }
  if (renders.get(canvas) !== generation) return;
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS_UNAVAILABLE");
  context.drawImage(output, 0, 0);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
}
/** Optional template. Callers can also compose their own canvas from renderWindChimeQr. */
export async function renderWindChimePoster(
  qrCanvas: HTMLCanvasElement,
  poster: WindChimePosterOptions,
): Promise<HTMLCanvasElement> {
  const { url } = poster;
  const W = poster.width ?? 900;
  const baseH = Math.round(W * 1.55);

  // 预先加载可选头像并测算标题/副标题总高度，确保长文案不会将二维码卡片顶出画布底部
  let loadedAvatar: HTMLImageElement | null = null;
  if (poster.avatarSrc) {
    try {
      loadedAvatar = await loadImage(poster.avatarSrc);
    } catch {
      loadedAvatar = null;
    }
  }

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  if (!measureCtx) throw new Error("CANVAS_UNAVAILABLE");

  const headingFont = `700 ${Math.round(W * 0.075)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  const bodyFont = `400 ${Math.round(W * 0.036)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  measureCtx.font = headingFont;
  const rawHeadingLines = poster.heading
    ? wrapText(measureCtx, poster.heading, W * 0.84)
    : [];
  const headingLines =
    rawHeadingLines.length > 2
      ? [rawHeadingLines[0]!, `${rawHeadingLines[1]!.slice(0, -1)}…`]
      : rawHeadingLines;

  measureCtx.font = bodyFont;
  const bodyLines = poster.body
    ? poster.body
        .split(/\r?\n/)
        .flatMap((para) =>
          para.trim() ? wrapText(measureCtx, para, W * 0.78) : [""],
        )
    : [];

  const aSize = Math.round(W * (poster.avatarSizeRatio ?? 0.22));
  let estY = loadedAvatar
    ? W * 0.08 + aSize + W * 0.045
    : poster.avatarSrc
      ? W * 0.1
      : W * 0.12;
  estY += Math.max(1, headingLines.length) * W * 0.085;
  if (bodyLines.length) {
    estY += bodyLines.length * W * 0.052 + W * 0.02;
  }
  const cardSize = Math.round(W * 0.58);
  const estCardBottom = estY + W * 0.05 + cardSize;
  const footerSpace = poster.brandingText ? W * 0.18 : W * 0.13;
  const H = Math.max(baseH, Math.ceil(estCardBottom + footerSpace));

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("CANVAS_UNAVAILABLE");

  // 渐变背景（始终绘制，作为背景图加载失败时的 fallback）
  const [g1, g2] = poster.gradient ?? ["#ffffff", "#ffffff"];
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
      const overlay = poster.backgroundImageOverlay ?? "rgba(0,0,0,0.38)";
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, W, H);
      bgImageDrawn = true;
    } catch {
      /* 加载失败则保持纯渐变 + 柔光圆 */
    }
  }

  // 柔光圆（仅无背景图时绘制，避免和背景图打架）
  if (!bgImageDrawn) {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(W * 0.85, H * 0.08, W * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W * 0.1, H * 0.92, W * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  const textColor = poster.textColor ?? "#111827";

  // 头像（圆形 + 光晕 + 白色描边）
  let cursorY = W * 0.08;
  if (loadedAvatar) {
    const ax = W / 2;
    const ay = cursorY + aSize / 2;
    // 外光晕
    const halo = ctx.createRadialGradient(
      ax,
      ay,
      aSize * 0.48,
      ax,
      ay,
      aSize * 0.95,
    );
    halo.addColorStop(0, "rgba(255,255,255,0.45)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(ax, ay, aSize * 0.95, 0, Math.PI * 2);
    ctx.fill();
    // 白环
    ctx.fillStyle = poster.avatarRingColor ?? "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(ax, ay, aSize / 2 + Math.round(W * 0.012), 0, Math.PI * 2);
    ctx.fill();
    // 头像裁圆（保持 cover 比例居中裁剪，避免非方形头像变形）
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, ay, aSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const avatarScale = Math.max(
      aSize / loadedAvatar.width,
      aSize / loadedAvatar.height,
    );
    const aw = loadedAvatar.width * avatarScale;
    const ah = loadedAvatar.height * avatarScale;
    ctx.drawImage(loadedAvatar, ax - aw / 2, ay - ah / 2, aw, ah);
    ctx.restore();
    cursorY = ay + aSize / 2 + W * 0.045;
  } else if (poster.avatarSrc) {
    cursorY = W * 0.1;
  } else {
    cursorY = W * 0.12;
  }

  // 标题（自动折行防止左右裁切）
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = headingFont;
  if (headingLines.length) {
    for (const line of headingLines) {
      cursorY += W * 0.068;
      ctx.fillText(line, W / 2, cursorY);
      cursorY += W * 0.017;
    }
  } else {
    cursorY += W * 0.08;
  }

  // 副标题
  if (bodyLines.length) {
    ctx.font = bodyFont;
    ctx.fillStyle = textColor;
    for (const line of bodyLines) {
      cursorY += W * 0.052;
      if (line) ctx.fillText(line, W / 2, cursorY);
    }
    cursorY += W * 0.02;
  }

  // QR 白底卡片
  const cardX = (W - cardSize) / 2;
  const cardY = cursorY + W * 0.05;
  // 卡片阴影
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.22)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, cardX, cardY, cardSize, cardSize, 32);
  ctx.fill();
  ctx.restore();
  // 将 QR canvas 缩放绘制到卡片内（留内边距）
  const inner = Math.round(cardSize * 0.86);
  const innerX = cardX + (cardSize - inner) / 2;
  const innerY = cardY + (cardSize - inner) / 2;
  ctx.drawImage(qrCanvas, innerX, innerY, inner, inner);

  // 落款（空串自动回退为去协议的分享网址，与编辑器提示一致）
  const footerText =
    poster.footer?.trim() || url.replace(/^https?:\/\//i, "");
  ctx.fillStyle = textColor;
  ctx.font = `600 ${Math.round(W * 0.034)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  ctx.fillText(footerText, W / 2, cardY + cardSize + W * 0.075, W * 0.88);
  if (poster.brandingText) {
    ctx.save();
    ctx.font = `400 ${Math.round(W * 0.026)}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
    ctx.fillStyle = textColor;
    ctx.globalAlpha = 0.72;
    ctx.fillText(poster.brandingText, W / 2, H - W * 0.045, W * 0.88);
    ctx.restore();
  }

  return out;
}
export function windChimeCanvasToBlob(
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("CANVAS_EXPORT_FAILED")),
        "image/png",
      );
    } catch (error) {
      reject(error);
    }
  });
}
export async function downloadWindChimeCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<void> {
  const blob = await windChimeCanvasToBlob(canvas);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
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
