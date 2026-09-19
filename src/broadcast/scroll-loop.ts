/** Scrolls only the currently mounted, already-approved card. Never advances the queue. */
export function startDisplayScroll(viewport: HTMLElement, content: HTMLElement, options: {
  enabled: boolean; speed: number; startPauseMs: number; endPauseMs: number;
}, clock: {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
} = { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) }) {
  let active = true, frame = 0, previous: number | null = null, elapsed = 0, offset = 0;
  let phase: 'top' | 'scrolling' | 'bottom' | 'still' = 'top';
  let maximum = 0, measuredHeight = -1, measuredViewport = -1;
  const paint = () => { viewport.scrollTop = offset; viewport.dataset.scrollPhase = phase; };
  const reset = () => {
    if (!active) return;
    measuredHeight = content.scrollHeight; measuredViewport = viewport.clientHeight;
    maximum = Math.max(0, measuredHeight - measuredViewport);
    elapsed = 0; offset = 0; previous = null;
    phase = options.enabled && maximum > 1 ? 'top' : 'still';
    paint();
  };
  const tick: FrameRequestCallback = now => {
    if (!active) return;
    if (measuredHeight !== content.scrollHeight || measuredViewport !== viewport.clientHeight) reset();
    const delta = previous === null ? 0 : Math.max(0, now - previous);
    previous = now;
    // A suspended window resumes from the beginning instead of jumping past unseen lines.
    if (delta > 500) { reset(); previous = now; }
    else if (phase === 'top') {
      elapsed += delta;
      if (elapsed >= options.startPauseMs) { phase = 'scrolling'; elapsed = 0; }
    } else if (phase === 'scrolling') {
      offset = Math.min(maximum, offset + delta * options.speed / 1000);
      if (offset >= maximum) { phase = 'bottom'; elapsed = 0; }
    } else if (phase === 'bottom') {
      elapsed += delta;
      if (elapsed >= options.endPauseMs) { offset = 0; elapsed = 0; phase = 'top'; }
    }
    paint();
    frame = clock.request(tick);
  };
  reset(); frame = clock.request(tick);
  return () => {
    active = false; clock.cancel(frame);
    // No timer, image callback or queued animation can repaint a detached snapshot.
  };
}
