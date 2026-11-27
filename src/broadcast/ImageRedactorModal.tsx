'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type RedactorTool = 'brush' | 'rect';
export type RedactorMode = 'mosaic' | 'solid';
export type RedactorPoint = { x: number; y: number };

export type ImageRedactorModalProps = {
  imageUrl: string;
  caption?: string;
  onCancel: () => void;
  onSave: (file: File) => Promise<void> | void;
};

const MAX_EXPORT_BYTES = Math.floor(4.5 * 1024 * 1024);
const MAX_HISTORY = 20;

export function computeRedactorCanvasSize(
  naturalWidth: number,
  naturalHeight: number,
  maxSide = 2400,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(naturalWidth || 1));
  const h = Math.max(1, Math.round(naturalHeight || 1));
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { width: w, height: h };
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function applyBlockAverage(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  bx: number,
  by: number,
  blockSize: number,
) {
  const x0 = Math.max(0, bx);
  const y0 = Math.max(0, by);
  const x1 = Math.min(imgW, bx + blockSize);
  const y1 = Math.min(imgH, by + blockSize);
  if (x1 <= x0 || y1 <= y0) return;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    let offset = (y * imgW + x0) * 4;
    for (let x = x0; x < x1; x++) {
      r += source[offset]!;
      g += source[offset + 1]!;
      b += source[offset + 2]!;
      a += source[offset + 3]!;
      count++;
      offset += 4;
    }
  }
  if (!count) return;
  const ar = Math.round(r / count);
  const ag = Math.round(g / count);
  const ab = Math.round(b / count);
  const aa = Math.round(a / count);
  for (let y = y0; y < y1; y++) {
    let offset = (y * imgW + x0) * 4;
    for (let x = x0; x < x1; x++) {
      target[offset] = ar;
      target[offset + 1] = ag;
      target[offset + 2] = ab;
      target[offset + 3] = aa;
      offset += 4;
    }
  }
}

export function pixelateRectData(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  blockSize: number,
): void {
  const step = Math.max(4, Math.round(blockSize));
  const minX = Math.max(0, Math.min(rx, rx + rw));
  const maxX = Math.min(imgW, Math.max(rx, rx + rw));
  const minY = Math.max(0, Math.min(ry, ry + rh));
  const maxY = Math.min(imgH, Math.max(ry, ry + rh));
  if (maxX <= minX || maxY <= minY) return;
  const startBx = Math.floor(minX / step) * step;
  const startBy = Math.floor(minY / step) * step;
  for (let by = startBy; by < maxY; by += step) {
    for (let bx = startBx; bx < maxX; bx += step) {
      applyBlockAverage(source, target, imgW, imgH, bx, by, step);
    }
  }
}

function distSqPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0.0001) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const ex = px - projX;
  const ey = py - projY;
  return ex * ex + ey * ey;
}

export function pixelateBrushSegmentData(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  from: RedactorPoint,
  to: RedactorPoint,
  radius: number,
  blockSize: number,
): void {
  const step = Math.max(4, Math.round(blockSize));
  const r = Math.max(step * 0.5, radius);
  const rSq = r * r;
  const minX = Math.max(0, Math.min(from.x, to.x) - r);
  const maxX = Math.min(imgW, Math.max(from.x, to.x) + r);
  const minY = Math.max(0, Math.min(from.y, to.y) - r);
  const maxY = Math.min(imgH, Math.max(from.y, to.y) + r);
  const startBx = Math.floor(minX / step) * step;
  const startBy = Math.floor(minY / step) * step;
  for (let by = startBy; by < maxY; by += step) {
    const cy = by + step * 0.5;
    for (let bx = startBx; bx < maxX; bx += step) {
      const cx = bx + step * 0.5;
      if (distSqPointToSegment(cx, cy, from.x, from.y, to.x, to.y) <= rSq) {
        applyBlockAverage(source, target, imgW, imgH, bx, by, step);
      }
    }
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob | null> {
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), mimeType, quality);
  });
}

async function exportRedactedFile(canvas: HTMLCanvasElement): Promise<File> {
  const png = await canvasToBlob(canvas, 'image/png');
  if (png && png.size <= MAX_EXPORT_BYTES) {
    return new File([png], 'redacted.png', { type: 'image/png' });
  }
  const jpgHigh = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  if (jpgHigh && jpgHigh.size <= MAX_EXPORT_BYTES) {
    return new File([jpgHigh], 'redacted.jpg', { type: 'image/jpeg' });
  }
  const jpgMid = await canvasToBlob(canvas, 'image/jpeg', 0.8);
  if (jpgMid && jpgMid.size <= MAX_EXPORT_BYTES) {
    return new File([jpgMid], 'redacted.jpg', { type: 'image/jpeg' });
  }
  throw new Error('打码图片体积超过限制，请缩小后重试');
}

export function ImageRedactorModal({ imageUrl, caption, onCancel, onSave }: ImageRedactorModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceDataRef = useRef<ImageData | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const dragBeforeRef = useRef<ImageData | null>(null);
  const workingDataRef = useRef<ImageData | null>(null);
  const lastPointRef = useRef<RedactorPoint | null>(null);
  const rectStartRef = useRef<RedactorPoint | null>(null);
  const activePointerRef = useRef<number | null>(null);

  const [tool, setTool] = useState<RedactorTool>('brush');
  const [mode, setMode] = useState<RedactorMode>('mosaic');
  const [blockLevel, setBlockLevel] = useState<'fine' | 'medium' | 'coarse'>('medium');
  const [brushSize, setBrushSize] = useState(42);
  const [ready, setReady] = useState(false);
  const [historyLen, setHistoryLen] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError('');
    historyRef.current = [];
    setHistoryLen(0);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { width, height } = computeRedactorCanvasSize(img.naturalWidth, img.naturalHeight, 2400);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setError('无法初始化画布');
        return;
      }
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      try {
        sourceDataRef.current = ctx.getImageData(0, 0, width, height);
        setReady(true);
      } catch {
        setError('图片存在跨域限制，无法读取像素进行局部打码');
      }
    };
    img.onerror = () => {
      if (!cancelled) setError('图片加载失败，无法打开局部打码编辑器');
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const scaledBlockSize = useCallback(() => {
    const canvas = canvasRef.current;
    const base = blockLevel === 'fine' ? 11 : blockLevel === 'coarse' ? 28 : 18;
    if (!canvas) return base;
    const factor = Math.max(0.65, Math.max(canvas.width, canvas.height) / 960);
    return Math.max(6, Math.round(base * factor));
  }, [blockLevel]);

  const scaledBrushRadius = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return brushSize * 0.5;
    const factor = Math.max(0.6, Math.max(canvas.width, canvas.height) / 960);
    return Math.max(8, Math.round((brushSize * 0.5) * factor));
  }, [brushSize]);

  const undo = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !ctx || !historyRef.current.length) return;
    const prev = historyRef.current.pop()!;
    ctx.putImageData(prev, 0, 0);
    setHistoryLen(historyRef.current.length);
  }, []);

  const reset = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    const source = sourceDataRef.current;
    if (!canvas || !ctx || !source) return;
    ctx.putImageData(source, 0, 0);
    historyRef.current = [];
    setHistoryLen(0);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault();
        onCancel();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'z' &&
        !saving &&
        activePointerRef.current === null
      ) {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, saving, undo]);

  const toCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>): RedactorPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const pushHistorySnapshot = (snapshot: ImageData) => {
    historyRef.current.push(snapshot);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    }
    setHistoryLen(historyRef.current.length);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ready || saving || event.button !== 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    const source = sourceDataRef.current;
    const pt = toCanvasPoint(event);
    if (!canvas || !ctx || !source || !pt) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
    dragBeforeRef.current = before;

    if (tool === 'brush') {
      lastPointRef.current = pt;
      if (mode === 'mosaic') {
        const work = new ImageData(new Uint8ClampedArray(before.data), canvas.width, canvas.height);
        workingDataRef.current = work;
        // Always sample from `before.data` (current redacted canvas), never raw `source.data`,
        // so brushing mosaic over solid bars or coarse mosaic never de-redacts underlying pixels.
        pixelateBrushSegmentData(
          before.data,
          work.data,
          canvas.width,
          canvas.height,
          pt,
          pt,
          scaledBrushRadius(),
          scaledBlockSize(),
        );
        ctx.putImageData(work, 0, 0);
      } else {
        ctx.save();
        ctx.fillStyle = '#141f2b';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, scaledBrushRadius(), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else {
      rectStartRef.current = pt;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId || !ready || saving) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    const source = sourceDataRef.current;
    const pt = toCanvasPoint(event);
    if (!canvas || !ctx || !source || !pt) return;

    if (tool === 'brush') {
      const prev = lastPointRef.current ?? pt;
      lastPointRef.current = pt;
      if (mode === 'mosaic') {
        const work = workingDataRef.current;
        const before = dragBeforeRef.current;
        if (!work || !before) return;
        pixelateBrushSegmentData(
          before.data,
          work.data,
          canvas.width,
          canvas.height,
          prev,
          pt,
          scaledBrushRadius(),
          scaledBlockSize(),
        );
        ctx.putImageData(work, 0, 0);
      } else {
        ctx.save();
        ctx.strokeStyle = '#141f2b';
        ctx.lineWidth = scaledBrushRadius() * 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
        ctx.restore();
      }
    } else if (rectStartRef.current && dragBeforeRef.current) {
      const start = rectStartRef.current;
      ctx.putImageData(dragBeforeRef.current, 0, 0);
      const x = Math.min(start.x, pt.x);
      const y = Math.min(start.y, pt.y);
      const w = Math.abs(pt.x - start.x);
      const h = Math.abs(pt.y - start.y);
      ctx.save();
      ctx.fillStyle = mode === 'solid' ? 'rgba(20, 31, 43, 0.85)' : 'rgba(143, 225, 213, 0.28)';
      ctx.strokeStyle = '#8fe1d5';
      ctx.lineWidth = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) / 420));
      ctx.setLineDash([8, 5]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  };

  const finishPointer = (event: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    const source = sourceDataRef.current;
    const before = dragBeforeRef.current;
    dragBeforeRef.current = null;
    workingDataRef.current = null;
    lastPointRef.current = null;

    if (!canvas || !ctx || !source || !before) {
      rectStartRef.current = null;
      return;
    }

    if (cancelled) {
      ctx.putImageData(before, 0, 0);
      rectStartRef.current = null;
      return;
    }

    if (tool === 'rect' && rectStartRef.current) {
      const start = rectStartRef.current;
      rectStartRef.current = null;
      const pt = toCanvasPoint(event) ?? start;
      const x = Math.min(start.x, pt.x);
      const y = Math.min(start.y, pt.y);
      const w = Math.abs(pt.x - start.x);
      const h = Math.abs(pt.y - start.y);
      ctx.putImageData(before, 0, 0);
      if (w < 4 || h < 4) return;
      if (mode === 'mosaic') {
        const next = new ImageData(new Uint8ClampedArray(before.data), canvas.width, canvas.height);
        pixelateRectData(before.data, next.data, canvas.width, canvas.height, x, y, w, h, scaledBlockSize());
        ctx.putImageData(next, 0, 0);
      } else {
        ctx.save();
        ctx.fillStyle = '#141f2b';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      }
      pushHistorySnapshot(before);
    } else if (tool === 'brush') {
      pushHistorySnapshot(before);
    }
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !ready || saving || historyLen === 0) return;
    setSaving(true);
    setError('');
    try {
      const file = await exportRedactedFile(canvas);
      await onSave(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存打码图片失败');
      setSaving(false);
    }
  };

  const modalContent = (
    <div
      className="wc-redactor-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="附图局部隐私打码"
      onClick={e => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div className="wc-redactor-dialog">
        <header className="wc-redactor-head">
          <div>
            <strong>附图局部打码（仅主播私下可见）</strong>
            <span className="wc-muted">
              {caption ? `说明：${caption} · ` : ''}
              直接涂抹或框选微信号、二维码等隐私区域；原始投稿图永久保留可随时还原
            </span>
          </div>
          <button type="button" className="wc-subtle wc-queue-small" disabled={saving} onClick={onCancel}>
            关闭
          </button>
        </header>

        <div className="wc-redactor-toolbar">
          <div className="wc-redactor-group" role="group" aria-label="绘制工具">
            <button
              type="button"
              className="wc-queue-small"
              aria-pressed={tool === 'brush'}
              disabled={saving}
              onClick={() => setTool('brush')}
            >
              🖌 涂抹画笔
            </button>
            <button
              type="button"
              className="wc-queue-small"
              aria-pressed={tool === 'rect'}
              disabled={saving}
              onClick={() => setTool('rect')}
            >
              ▭ 矩形框选
            </button>
          </div>

          <div className="wc-redactor-group" role="group" aria-label="打码样式">
            <button
              type="button"
              className="wc-queue-small"
              aria-pressed={mode === 'mosaic'}
              disabled={saving}
              onClick={() => setMode('mosaic')}
            >
              像素马赛克
            </button>
            <button
              type="button"
              className="wc-queue-small"
              aria-pressed={mode === 'solid'}
              disabled={saving}
              onClick={() => setMode('solid')}
            >
              纯色遮挡条
            </button>
          </div>

          {mode === 'mosaic' ? (
            <div className="wc-redactor-group" role="group" aria-label="马赛克块大小">
              {(
                [
                  ['fine', '细格'],
                  ['medium', '中格'],
                  ['coarse', '粗格'],
                ] as const
              ).map(([lvl, lbl]) => (
                <button
                  key={lvl}
                  type="button"
                  className="wc-queue-small"
                  aria-pressed={blockLevel === lvl}
                  disabled={saving}
                  onClick={() => setBlockLevel(lvl)}
                >
                  {lbl}
                </button>
              ))}
            </div>
          ) : null}

          {tool === 'brush' ? (
            <label className="wc-redactor-slider">
              <span>笔触</span>
              <input
                type="range"
                min={18}
                max={96}
                step={2}
                value={brushSize}
                disabled={saving}
                onChange={e => setBrushSize(Number(e.target.value))}
              />
            </label>
          ) : null}

          <div className="wc-actions" style={{ marginLeft: 'auto' }}>
            <button type="button" className="wc-queue-small" disabled={saving || historyLen === 0} onClick={undo}>
              {historyLen > 0 ? `撤销 (${historyLen})` : '撤销'}
            </button>
            <button type="button" className="wc-queue-small" disabled={saving || historyLen === 0} onClick={reset}>
              重置原图
            </button>
          </div>
        </div>

        <div className="wc-redactor-stage">
          {!ready && !error ? <span className="wc-muted">正在载入高清原图…</span> : null}
          <canvas
            ref={canvasRef}
            className="wc-redactor-canvas"
            style={{ display: ready ? 'block' : 'none', cursor: tool === 'rect' ? 'crosshair' : 'cell' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={e => finishPointer(e, false)}
            onPointerCancel={e => finishPointer(e, true)}
            onLostPointerCapture={e => finishPointer(e, true)}
          />
        </div>

        {error ? <p className="wc-error" role="alert" style={{ margin: 0 }}>{error}</p> : null}

        <footer className="wc-redactor-foot">
          <span className="wc-muted">
            {historyLen === 0
              ? '在图片上涂抹或拖拽框选需要隐藏的区域（Ctrl+Z 可撤销）'
              : `已涂抹 ${historyLen} 处隐私遮挡 · 保存后替换本次展示稿附图`}
          </span>
          <div className="wc-actions">
            <button type="button" className="wc-subtle" disabled={saving} onClick={onCancel}>
              取消
            </button>
            <button
              type="button"
              className="wc-primary"
              disabled={!ready || saving || historyLen === 0}
              onClick={() => void handleSave()}
            >
              {saving ? '正在上传打码图…' : '完成打码并替换'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  const portalTarget =
    typeof document !== 'undefined' ? document.querySelector('.wc-desktop') ?? document.body : null;
  return portalTarget
    ? createPortal(<div className="wc-live wc-modal-portal">{modalContent}</div>, portalTarget)
    : modalContent;
}
