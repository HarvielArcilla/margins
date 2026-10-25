// Keeping the reader smooth: background work waits for idle time and steps
// aside while something is animating, and a few helpers to coalesce work.

let animating = 0;
const waiters = [];

// Wrap an animation so background work pauses for its duration.
export async function animation(fn) {
  animating++;
  try { return await fn(); } finally {
    animating--;
    if (!animating) setTimeout(flush, 120);
  }
}

export function isAnimating() { return animating > 0; }

function flush() {
  if (animating) return;
  while (waiters.length && !animating) waiters.shift()();
}

// Resolves when the browser is idle and nothing is animating. Long-running
// background jobs should await this between steps.
export function idle(timeout = 400) {
  return new Promise((resolve) => {
    const go = () => {
      if (animating) { waiters.push(go); return; }
      if ('requestIdleCallback' in window) requestIdleCallback(() => (animating ? waiters.push(go) : resolve()), { timeout });
      else setTimeout(resolve, 16);
    };
    go();
  });
}

// Call fn at most once per animation frame, with the latest arguments.
export function perFrame(fn) {
  let raf = 0, args = null;
  return (...a) => {
    args = a;
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; fn(...args); });
  };
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
export const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// Whether this window draws without a GPU (hardware acceleration off): the
// app then picks lighter effects.
let soft = null;
export function softwareRendering() {
  if (soft !== null) return soft;
  soft = document.documentElement.dataset.gpu === 'off';
  return soft;
}
