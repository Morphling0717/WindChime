import { useEffect, type RefObject } from "react";

type PillTrackConfig = {
  containerSelector: string;
  activeSelector: string;
  axis: "x" | "y";
  variant: "nav" | "segment" | "mode";
};

const PILL_TRACKS: readonly PillTrackConfig[] = [
  {
    containerSelector: ".desktop-sidebar nav",
    activeSelector: 'button[aria-current="page"]',
    axis: "y",
    variant: "nav",
  },
  {
    containerSelector: ".settings-tabs",
    activeSelector: 'button[aria-selected="true"]',
    axis: "x",
    variant: "segment",
  },
  {
    containerSelector: ".wc-mode-switch",
    activeSelector: 'button[aria-pressed="true"]',
    axis: "x",
    variant: "mode",
  },
  {
    containerSelector: ".obs-mode-tabs",
    activeSelector: 'button[aria-selected="true"]',
    axis: "x",
    variant: "segment",
  },
  {
    containerSelector: ".wc-bb-filter-group",
    activeSelector: 'button[aria-pressed="true"]',
    axis: "x",
    variant: "segment",
  },
];

const SHEEN_SELECTOR = [
  ".desktop-sidebar",
  ".desktop-hide",
  ".titlebar-onair",
  ".sidebar-theme-toggle",
  ".wc-bb-go-live",
  ".wc-bb-draw-btn",
  ".wc-primary",
  ".desktop-workspace-bar button",
  ".surface-choice",
  ".tile-window-actions button",
].join(",");

type TrackInstance = {
  pill: HTMLSpanElement;
  container: HTMLElement;
  config: PillTrackConfig;
  lastRect: { x: number; y: number; w: number; h: number } | null;
  stretchTimer: number | null;
  initFrame: number;
  disposed: boolean;
  ro: ResizeObserver;
  mo: MutationObserver;
  update: (animate: boolean) => void;
  destroy: () => void;
};

function mountPillTrack(container: HTMLElement, config: PillTrackConfig): TrackInstance {
  // Remove any stale pill that could survive abnormal teardown
  for (const stale of Array.from(container.querySelectorAll<HTMLElement>(":scope > .lg-sliding-pill"))) {
    stale.remove();
  }
  const pill = document.createElement("span");
  pill.className = `lg-sliding-pill is-${config.variant}`;
  pill.setAttribute("aria-hidden", "true");
  container.classList.add("has-lg-pill");
  container.prepend(pill);

  const instance: TrackInstance = {
    pill,
    container,
    config,
    lastRect: null,
    stretchTimer: null,
    initFrame: 0,
    disposed: false,
    ro: null as unknown as ResizeObserver,
    mo: null as unknown as MutationObserver,
    update(animate: boolean) {
      if (instance.disposed) return;
      const active = container.querySelector<HTMLElement>(config.activeSelector);
      if (!active || active.offsetWidth === 0 || active.offsetHeight === 0) {
        pill.style.opacity = "0";
        return;
      }
      const next = {
        x: active.offsetLeft,
        y: active.offsetTop,
        w: active.offsetWidth,
        h: active.offsetHeight,
      };
      const prev = instance.lastRect;
      const moved =
        prev !== null &&
        (Math.abs(prev.x - next.x) > 2 || Math.abs(prev.y - next.y) > 2);

      if (!animate || prev === null) {
        pill.classList.add("is-instant");
        pill.style.setProperty("--lg-px", `${next.x}px`);
        pill.style.setProperty("--lg-py", `${next.y}px`);
        pill.style.setProperty("--lg-pw", `${next.w}px`);
        pill.style.setProperty("--lg-ph", `${next.h}px`);
        pill.style.opacity = "1";
        void pill.offsetWidth;
        pill.classList.remove("is-instant");
      } else {
        pill.style.setProperty("--lg-px", `${next.x}px`);
        pill.style.setProperty("--lg-py", `${next.y}px`);
        pill.style.setProperty("--lg-pw", `${next.w}px`);
        pill.style.setProperty("--lg-ph", `${next.h}px`);
        pill.style.opacity = "1";

        if (moved) {
          pill.classList.remove("is-stretching-x", "is-stretching-y");
          void pill.offsetWidth;
          pill.classList.add(config.axis === "x" ? "is-stretching-x" : "is-stretching-y");
          if (instance.stretchTimer !== null) window.clearTimeout(instance.stretchTimer);
          instance.stretchTimer = window.setTimeout(() => {
            pill.classList.remove("is-stretching-x", "is-stretching-y");
            instance.stretchTimer = null;
          }, 340);
        }
      }
      instance.lastRect = next;
    },
    destroy() {
      instance.disposed = true;
      if (instance.initFrame) {
        cancelAnimationFrame(instance.initFrame);
        instance.initFrame = 0;
      }
      if (instance.stretchTimer !== null) {
        window.clearTimeout(instance.stretchTimer);
        instance.stretchTimer = null;
      }
      instance.ro.disconnect();
      instance.mo.disconnect();
      container.classList.remove("has-lg-pill");
      pill.remove();
    },
  };

  instance.ro = new ResizeObserver(() => instance.update(false));
  instance.ro.observe(container);
  for (const child of Array.from(container.children)) {
    if (child !== pill && child instanceof HTMLElement) instance.ro.observe(child);
  }

  instance.mo = new MutationObserver(() => instance.update(true));
  instance.mo.observe(container, {
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-current", "aria-selected", "aria-pressed", "class", "hidden"],
    childList: true,
  });

  // Measure after initial layout settles
  instance.initFrame = requestAnimationFrame(() => {
    instance.initFrame = 0;
    instance.update(false);
  });
  return instance;
}

/**
 * Equips the WindChime desktop root with:
 * 1. Apple-style fluid spring-morphing glass pill indicators across navs & segmented switches.
 * 2. rAF-throttled pointer-tracked specular rim light on interactive glass chrome.
 * Automatically tears down everything in `standard` / `lite` modes or reduced-motion.
 */
export function useLiquidGlassMotion(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    const mounted = new Map<HTMLElement, TrackInstance>();
    let disposed = false;

    const scanTracks = () => {
      if (disposed) return;
      // Prune detached containers
      for (const [el, inst] of mounted) {
        if (!root.contains(el)) {
          inst.destroy();
          mounted.delete(el);
        }
      }
      // Attach any newly rendered segmented bar or nav
      for (const config of PILL_TRACKS) {
        const nodes = Array.from(root.querySelectorAll<HTMLElement>(config.containerSelector));
        for (const el of nodes) {
          if (!mounted.has(el)) {
            mounted.set(el, mountPillTrack(el, config));
          } else {
            mounted.get(el)!.update(true);
          }
        }
      }
    };

    let scanFrame = 0;
    const queueScan = () => {
      if (disposed || scanFrame) return;
      scanFrame = requestAnimationFrame(() => {
        scanFrame = 0;
        if (!disposed) scanTracks();
      });
    };

    scanTracks();

    const rootObserver = new MutationObserver(queueScan);
    rootObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });

    // Delegated pointer specular sheen (zero React re-renders, 1 rAF per pointer frame)
    let activeTarget: HTMLElement | null = null;
    let pointerFrame = 0;
    let lastClientX = 0;
    let lastClientY = 0;

    const clearTarget = () => {
      if (activeTarget) {
        activeTarget.style.setProperty("--lg-glow", "0");
        activeTarget = null;
      }
    };

    const flushPointer = () => {
      pointerFrame = 0;
      if (!activeTarget || !root.contains(activeTarget)) {
        activeTarget = null;
        return;
      }
      const rect = activeTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const mx = Math.max(0, Math.min(100, ((lastClientX - rect.left) / rect.width) * 100));
      const my = Math.max(0, Math.min(100, ((lastClientY - rect.top) / rect.height) * 100));
      activeTarget.style.setProperty("--lg-mx", `${mx.toFixed(1)}%`);
      activeTarget.style.setProperty("--lg-my", `${my.toFixed(1)}%`);
      activeTarget.style.setProperty("--lg-glow", "1");
    };

    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion || document.hidden) return;
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(SHEEN_SELECTOR)
          : null;
      if (target !== activeTarget) {
        clearTarget();
        activeTarget = target;
      }
      if (!activeTarget) return;
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      if (!pointerFrame) pointerFrame = requestAnimationFrame(flushPointer);
    };

    const onPointerLeave = () => clearTarget();
    const onBlur = () => clearTarget();
    const onScrollSync = () => {
      const scrolled = window.scrollY > 8;
      root.dataset.scrolled = scrolled ? "1" : "0";
    };

    onScrollSync();
    root.addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerleave", onPointerLeave, { passive: true });
    window.addEventListener("blur", onBlur);
    window.addEventListener("scroll", onScrollSync, { passive: true });

    return () => {
      disposed = true;
      rootObserver.disconnect();
      if (scanFrame) {
        cancelAnimationFrame(scanFrame);
        scanFrame = 0;
      }
      for (const inst of mounted.values()) inst.destroy();
      mounted.clear();
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      clearTarget();
      delete root.dataset.scrolled;
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("scroll", onScrollSync);
    };
  }, [rootRef, enabled]);
}
