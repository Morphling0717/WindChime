export type WindChimeDisplayScrollCommand =
  | { type: 'ratio'; ratio: number }
  | { type: 'step'; delta: number }
  | { type: 'top' }
  | { type: 'togglePause'; paused?: boolean };

export type WindChimeDisplayScrollMetrics = {
  ratio: number;
  offset: number;
  maximum: number;
  viewportHeight: number;
  contentHeight: number;
  paused: boolean;
  autoEnabled: boolean;
  phase: 'top' | 'scrolling' | 'bottom' | 'still' | 'manual';
};

export type WindChimeDisplayScrollController = {
  subscribe: (handler: (command: WindChimeDisplayScrollCommand) => void) => () => void;
  onMetrics?: (metrics: WindChimeDisplayScrollMetrics | null) => void;
};

/** Scrolls only the currently mounted, already-approved card. Never advances the queue. */
export function startDisplayScroll(viewport: HTMLElement, content: HTMLElement, options: {
  enabled: boolean; speed: number; startPauseMs: number; endPauseMs: number;
  control?: WindChimeDisplayScrollController;
  overlayPaused?: boolean;
  subscribeOverlayPause?: (handler: (paused: boolean) => void) => () => void;
}, clock: {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
} = { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) }) {
  let active = true, frame = 0, previous: number | null = null, elapsed = 0, offset = 0;
  let phase: WindChimeDisplayScrollMetrics['phase'] = 'top';
  let maximum = 0, measuredHeight = -1, measuredViewport = -1;
  let manualPaused = !options.enabled;
  let overlayPaused = Boolean(options.overlayPaused);
  let manualInteracted = false;
  let targetOffset: number | null = null;
  let lastReported = '';
  const hasResizeObserver =
    typeof ResizeObserver === 'function' &&
    typeof Element === 'function' &&
    viewport instanceof Element &&
    content instanceof Element;

  const needsTick = () =>
    active && (targetOffset !== null || (!manualPaused && !overlayPaused && maximum > 1));

  const schedule = () => {
    if (!active || frame !== 0) return;
    if (!hasResizeObserver || needsTick()) {
      frame = clock.request(tick);
    }
  };

  const report = (force = false) => {
    if (!options.control?.onMetrics) return;
    const ratio = maximum > 0 ? Math.min(1, Math.max(0, offset / maximum)) : 0;
    const roundedOffset = Math.round(offset);
    const key = `${roundedOffset}:${Math.round(maximum)}:${manualPaused ? 1 : 0}:${phase}`;
    if (!force && key === lastReported) return;
    lastReported = key;
    options.control.onMetrics({
      ratio,
      offset,
      maximum,
      viewportHeight: Math.max(0, measuredViewport),
      contentHeight: Math.max(0, measuredHeight),
      paused: manualPaused,
      autoEnabled: options.enabled,
      phase,
    });
  };

  const paint = (forceReport = false) => {
    viewport.scrollTop = offset;
    viewport.dataset.scrollPhase = phase;
    report(forceReport);
  };

  const measure = () => {
    measuredHeight = content.scrollHeight;
    measuredViewport = viewport.clientHeight;
    maximum = Math.max(0, measuredHeight - measuredViewport);
  };

  const syncDimensions = () => {
    if (measuredHeight === content.scrollHeight && measuredViewport === viewport.clientHeight) return;
    if (!manualInteracted) {
      reset();
    } else {
      const previousRatio = maximum > 0 ? offset / maximum : 0;
      measure();
      offset = Math.min(maximum, previousRatio * maximum);
      if (targetOffset !== null) targetOffset = Math.min(maximum, targetOffset);
      if (maximum <= 1) {
        offset = 0;
        targetOffset = null;
        phase = 'still';
      } else if (phase === 'still') {
        phase = manualPaused ? 'manual' : 'scrolling';
      }
      paint(true);
    }
  };

  const reset = () => {
    if (!active) return;
    measure();
    elapsed = 0; offset = 0; previous = null; targetOffset = null;
    manualPaused = !options.enabled;
    manualInteracted = false;
    phase = options.enabled && maximum > 1 ? 'top' : 'still';
    paint(true);
  };

  const handleCommand = (command: WindChimeDisplayScrollCommand) => {
    if (!active || !command || typeof command !== 'object') return;
    measure();
    if (command.type === 'ratio') {
      if (!Number.isFinite(command.ratio)) return;
      manualInteracted = true;
      manualPaused = true;
      targetOffset = maximum > 0 ? Math.min(1, Math.max(0, command.ratio)) * maximum : 0;
      phase = maximum > 1 ? 'manual' : 'still';
      paint(true);
    } else if (command.type === 'step') {
      if (!Number.isFinite(command.delta)) return;
      manualInteracted = true;
      manualPaused = true;
      const base = targetOffset ?? offset;
      const stepPx = command.delta * Math.max(40, measuredViewport);
      targetOffset = maximum > 0 ? Math.max(0, Math.min(maximum, base + stepPx)) : 0;
      phase = maximum > 1 ? 'manual' : 'still';
      paint(true);
    } else if (command.type === 'top') {
      if (!manualPaused && maximum > 1) {
        offset = 0; targetOffset = null; elapsed = 0; phase = 'top';
      } else {
        manualInteracted = true;
        targetOffset = 0;
        phase = maximum > 1 ? 'manual' : 'still';
      }
      paint(true);
    } else if (command.type === 'togglePause') {
      const nextPaused = typeof command.paused === 'boolean' ? command.paused : !manualPaused;
      manualInteracted = true;
      manualPaused = nextPaused;
      targetOffset = null;
      if (maximum <= 1) {
        phase = 'still';
      } else if (manualPaused) {
        phase = 'manual';
      } else {
        elapsed = 0;
        phase = offset >= maximum ? 'bottom' : 'scrolling';
      }
      paint(true);
    }
    if (hasResizeObserver && frame === 0 && needsTick()) {
      previous = null;
      schedule();
    }
  };

  const unsubscribe = options.control?.subscribe(handleCommand);
  const unsubscribeOverlay = options.subscribeOverlayPause?.(nextPaused => {
    if (!active) return;
    const wasPaused = overlayPaused;
    overlayPaused = Boolean(nextPaused);
    if (wasPaused && !overlayPaused) {
      previous = null;
      schedule();
    }
  });

  const resizeObserver = hasResizeObserver
    ? new ResizeObserver(() => {
        if (!active) return;
        syncDimensions();
        if (frame === 0 && needsTick()) {
          previous = null;
          schedule();
        }
      })
    : null;
  if (resizeObserver) {
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);
  }

  const tick: FrameRequestCallback = now => {
    frame = 0;
    if (!active) return;
    syncDimensions();
    const rawDelta = previous === null ? 0 : Math.max(0, now - previous);
    previous = now;
    if (targetOffset !== null) {
      const stepDelta = Math.min(rawDelta, 64);
      const diff = targetOffset - offset;
      if (Math.abs(diff) <= 0.75 || stepDelta <= 0) {
        offset = Math.abs(diff) <= 0.75 ? targetOffset : offset;
        if (offset === targetOffset) targetOffset = null;
      } else {
        const factor = Math.min(1, Math.max(0.22, stepDelta / 45));
        offset = Math.max(0, Math.min(maximum, offset + diff * factor));
        if (Math.abs(targetOffset - offset) <= 0.75) { offset = targetOffset; targetOffset = null; }
      }
    } else if (!manualPaused && !overlayPaused && maximum > 1) {
      // A suspended window resumes from the beginning instead of jumping past unseen lines,
      // while preserving an explicit manual unpause.
      if (rawDelta > 500) {
        elapsed = 0;
        offset = 0;
        targetOffset = null;
        phase = maximum > 1 ? 'top' : 'still';
        previous = now;
      } else if (phase === 'top') {
        elapsed += rawDelta;
        if (elapsed >= options.startPauseMs) { phase = 'scrolling'; elapsed = 0; }
      } else if (phase === 'scrolling') {
        offset = Math.min(maximum, offset + rawDelta * options.speed / 1000);
        if (offset >= maximum) { phase = 'bottom'; elapsed = 0; }
      } else if (phase === 'bottom') {
        elapsed += rawDelta;
        if (elapsed >= options.endPauseMs) { offset = 0; elapsed = 0; phase = 'top'; }
      }
    }
    paint();
    if (!hasResizeObserver || needsTick()) {
      frame = clock.request(tick);
    } else {
      previous = null;
    }
  };
  reset();
  schedule();
  return () => {
    active = false;
    if (frame !== 0) { clock.cancel(frame); frame = 0; }
    resizeObserver?.disconnect();
    unsubscribeOverlay?.();
    unsubscribe?.();
    // No timer, image callback or queued animation can repaint a detached snapshot.
  };
}
