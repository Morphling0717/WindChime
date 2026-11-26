import { useEffect, useMemo, useState } from "react";

type MapSpec = {
  id: string;
  width: number;
  height: number;
  radius: number;
  bevel: number;
  scale: number;
  blur: number;
};

const FILTER_SPECS: readonly MapSpec[] = [
  {
    id: "wc-lg-pill",
    width: 240,
    height: 64,
    radius: 32,
    bevel: 15,
    scale: 22,
    blur: 0.7,
  },
  {
    id: "wc-lg-bar",
    width: 480,
    height: 52,
    radius: 16,
    bevel: 14,
    scale: 20,
    blur: 1.0,
  },
  {
    id: "wc-lg-panel",
    width: 240,
    height: 360,
    radius: 26,
    bevel: 16,
    scale: 16,
    blur: 1.4,
  },
];

const cachedMaps = new Map<string, string>();

function roundedRectEdgeDistance(x: number, y: number, w: number, h: number, r: number): number {
  const cx = w * 0.5;
  const cy = h * 0.5;
  const hw = w * 0.5;
  const hh = h * 0.5;
  const rad = Math.min(r, hw - 1, hh - 1);
  const qx = Math.abs(x - cx) - (hw - rad);
  const qy = Math.abs(y - cy) - (hh - rad);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  return rad - outside;
}

/**
 * Generates an optical convex-bevel displacement map (squircle/capsule profile).
 * Flat center = neutral (128, 128) -> zero text distortion.
 * Curved rim  = smooth Snell-like inward bending -> authentic Apple Liquid Glass rim refraction.
 */
function buildLensDisplacementDataUrl(spec: MapSpec): string {
  const existing = cachedMaps.get(spec.id);
  if (existing) return existing;

  const { width, height, radius, bevel } = spec;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const img = ctx.createImageData(width, height);
  const data = img.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const d = roundedRectEdgeDistance(x + 0.5, y + 0.5, width, height, radius);

      if (d >= bevel) {
        data[idx] = 128;
        data[idx + 1] = 128;
        data[idx + 2] = 128;
        data[idx + 3] = 255;
        continue;
      }

      const dx =
        roundedRectEdgeDistance(x + 1.5, y + 0.5, width, height, radius) -
        roundedRectEdgeDistance(x - 0.5, y + 0.5, width, height, radius);
      const dy =
        roundedRectEdgeDistance(x + 0.5, y + 1.5, width, height, radius) -
        roundedRectEdgeDistance(x + 0.5, y - 0.5, width, height, radius);
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;

      const u = Math.max(0, Math.min(1, 1 - Math.max(0, d) / bevel));
      // Smooth bell-bevel refraction: strong curved bend near rim, cleanly tapered at outermost 1.5px
      const edgeTaper = d < 1.8 ? Math.max(0.3, d / 1.8) : 1;
      const mag = Math.pow(Math.sin(u * Math.PI * 0.5), 1.4) * edgeTaper;

      data[idx] = Math.max(0, Math.min(255, Math.round(128 + nx * mag * 124)));
      data[idx + 1] = Math.max(0, Math.min(255, Math.round(128 + ny * mag * 124)));
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL("image/png");
  cachedMaps.set(spec.id, url);
  return url;
}

/**
 * Single-pass zero-darkening optical refraction filters for Chromium `backdrop-filter: url(#...)`.
 * Never multiplies or squares backdrop alpha, keeping translucent glass water-clear and luminous.
 */
export function LiquidGlassDefs({ enabled }: { enabled: boolean }) {
  const [reducedTransparency, setReducedTransparency] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const sync = () => setReducedTransparency(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  const active = enabled && !reducedTransparency;

  const maps = useMemo(() => {
    if (!active || typeof document === "undefined") return [];
    return FILTER_SPECS.map((spec) => ({
      ...spec,
      href: buildLensDisplacementDataUrl(spec),
    })).filter((entry) => Boolean(entry.href));
  }, [active]);

  if (!active || !maps.length) return null;

  return (
    <svg
      className="lg-svg-defs"
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: "fixed", width: 0, height: 0, pointerEvents: "none" }}
    >
      <defs>
        {maps.map((spec) => (
          <filter
            key={spec.id}
            id={spec.id}
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={spec.href}
              x="0"
              y="0"
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              result="lensMap"
            />
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation={spec.blur}
              result="crystalSoft"
            />
            <feDisplacementMap
              in="crystalSoft"
              in2="lensMap"
              scale={spec.scale}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
