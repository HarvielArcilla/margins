// Page-turn animations.
//
// Every animation works from a snapshot of the page area (the stage, not the
// header or footer). The snapshot is taken ahead of time, as soon as a page
// has settled, so a turn starts on the very next frame: the snapshot goes up
// over the book, the book moves to its new page underneath, and the snapshot
// is animated away.
//
// Layers inside the stage, above the live book:
//   .turn-snap   – the snapshot, drawn once at full resolution. Sheet
//                  animations (slide, push, cover, fade, zoom, rise) only
//                  move or fade it, which the compositor does without
//                  repainting. For curl and flip it shows the half of the
//                  spread that stays put.
//   .curl-canvas – WebGL: the turning leaf and its shadows (curl.js).
//
// Leaf turns: in a two-page spread the hinge is the spine; forward, the
// right-hand page turns over onto the left, back, the left-hand page turns
// over onto the right. With a single page the page turns away from its left
// edge, or (going back) the previous page comes back down over it.
import { $ } from './ui.js';
import { getSettings } from './settings.js';
import { R } from './reader.js';
import { Curl } from './curl.js';
import { animation, isAnimating, idle, nextFrame, nextPaint, softwareRendering } from './perf.js';

export const ANIMATIONS = [
  { id: 'none', name: 'None', blurb: 'Instant' },
  { id: 'curl', name: 'Page curl', blurb: 'Paper bends and turns over' },
  { id: 'flip', name: 'Flip', blurb: 'A stiff page swings over the spine' },
  { id: 'slide', name: 'Slide', blurb: 'Glides a little and crossfades' },
  { id: 'push', name: 'Push', blurb: 'New page pushes the old one out' },
  { id: 'cover', name: 'Cover', blurb: 'Old page slides off the new one' },
  { id: 'fade', name: 'Fade', blurb: 'Crossfade' },
  { id: 'zoom', name: 'Zoom', blurb: 'Old page lifts away' },
  { id: 'rise', name: 'Rise', blurb: 'Vertical glide and crossfade' },
];
const LEAF_KINDS = new Set(['curl', 'flip']);

// ---------- easing ----------
// cubic-bezier(x1, y1, x2, y2), like CSS
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) { const e = X(t) - x; const d = dX(t); if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break; t -= e / d; }
    t = Math.min(1, Math.max(0, t));
    return Y(t);
  };
}
// The corner lifts briskly and the page settles softly, with no stall.
const curlEase = bezier(0.42, 0.02, 0.2, 1);
const flipEase = bezier(0.45, 0, 0.25, 1);
const releaseEase = bezier(0.2, 0.6, 0.25, 1);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Set when another turn is requested mid-animation: the running animation
// jumps to its end so rapid turning never lags behind the reader.
let hurry = false;
export function hurryUp() { hurry = true; }

// ---------- layers ----------
let engine = null;
function curlEngine() {
  if (!engine) {
    engine = new Curl($('#stage'), { soft: softwareRendering() });
    engine.quality = QUALITY[qualityStep];
  }
  return engine;
}
export function webglAvailable() { return curlEngine().ok; }

let snapEl = null;
function snapLayer() {
  if (!snapEl) {
    snapEl = document.createElement('canvas');
    snapEl.className = 'turn-snap';
    snapEl.hidden = true;
    $('#stage').append(snapEl);
  }
  return snapEl;
}

// ---------- snapshots ----------
// A snapshot is valid for one page and one "look": anything that changes
// what the page looks like bumps the version.
let version = 0;
let snap = null; // { key, bitmap, W, H }
let preparing = null;
export function invalidate() { version++; snap = null; schedulePrepare(); }

const keyNow = () => `${R.meta?.id}|${R.location?.start?.cfi}|${version}|${$('#stage').clientWidth}x${$('#stage').clientHeight}`;

function overlayCovering() {
  // floating panels or popups over the page would be baked into the snapshot
  const b = document.body.classList;
  return b.contains('sidebar-open') || b.contains('settings-open') || !$('#sel-popup').hidden || !!document.querySelector('.modal-backdrop, .popup-menu');
}

async function takeSnapshot() {
  const stage = $('#stage');
  const r = stage.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return null;
  let raw;
  try { raw = await window.api.window.captureRaw({ x: r.left, y: r.top, width: r.width, height: r.height }); } catch { return null; }
  if (!raw?.data?.length) return null;
  const px = new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength);
  if (raw.order === 'bgra') {
    const u = new Uint32Array(px.buffer, px.byteOffset, px.byteLength >> 2);
    for (let i = 0; i < u.length; i++) {
      const v = u[i];
      u[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >> 16) & 0xff);
    }
  }
  const bitmap = await createImageBitmap(new ImageData(px, raw.width, raw.height));
  return { bitmap, W: r.width, H: r.height };
}

// panels and popups closing can make a snapshot possible again
new MutationObserver(() => { if (R.open && !overlayCovering()) schedulePrepare(260); })
  .observe(document.body, { attributes: true, attributeFilter: ['class'] });

let prepTimer = 0;
export function schedulePrepare(delay = 220) {
  clearTimeout(prepTimer);
  prepTimer = setTimeout(prepare, delay);
}

async function prepare() {
  const s = getSettings();
  if (!R.open || s.flow !== 'paginated' || s.pageAnimation === 'none') return;
  if (preparing || isAnimating()) { schedulePrepare(300); return; }
  await idle(500);
  if (!R.open || isAnimating() || overlayCovering()) { if (R.open) schedulePrepare(600); return; }
  const key = keyNow();
  if (snap?.key === key) return;
  preparing = (async () => {
    await document.fonts?.ready;
    await nextPaint();
    const shot = await takeSnapshot();
    // the page may have changed while capturing
    if (!shot || keyNow() !== key || isAnimating()) { shot?.bitmap.close?.(); return; }
    snap?.bitmap?.close?.();
    snap = { key, ...shot };
    if (LEAF_KINDS.has(getSettings().pageAnimation)) curlEngine().setImage(snap.bitmap);
  })();
  try { await preparing; } finally { preparing = null; }
}

async function currentSnapshot() {
  if (preparing) await preparing;
  if (snap?.key === keyNow()) return snap;
  // not ready (or out of date): take one now
  const shot = await takeSnapshot();
  if (!shot) return null;
  snap?.bitmap?.close?.();
  snap = { key: keyNow(), ...shot };
  return snap;
}

function showSnap(s, clip = null) {
  const c = snapLayer();
  if (c.width !== s.bitmap.width || c.height !== s.bitmap.height) { c.width = s.bitmap.width; c.height = s.bitmap.height; }
  c.getContext('2d', { alpha: false }).drawImage(s.bitmap, 0, 0);
  Object.assign(c.style, { width: `${s.W}px`, height: `${s.H}px`, clipPath: clip || '', opacity: '' });
  c.hidden = false;
  return c;
}

function hideSnap() {
  if (!snapEl) return;
  snapEl.getAnimations().forEach((a) => a.cancel());
  snapEl.hidden = true;
}

function themeColors() {
  const s = getSettings();
  const theme = R.theme || { bg: '#ffffff' };
  // drawn paper has to match the night light and dimming laid over the page
  const warm = (s.warmth / 100) * 0.22;
  const dim = 1 - s.brightness / 100;
  const orange = [1, 122 / 255, 16 / 255];
  const tint = [0, 1, 2].map((i) => (1 - warm + warm * orange[i]) * (1 - dim));
  return { paper: theme.bg, tint };
}

// Waits until the page the book just moved to has actually been drawn.
async function settled() {
  await nextPaint();
  await document.fonts?.ready;
  await nextFrame();
}

// ---------- the entry point ----------
// sign: +1 for a turn that moves visually leftward (forward in left-to-right
// books), -1 for the reverse.
export async function animate(kind, sign, ms, go) {
  hurry = false;
  if (kind === 'none' || overlayCovering()) return go();
  return animation(async () => {
    const s = await currentSnapshot();
    if (!s) return go();
    if (LEAF_KINDS.has(kind) && webglAvailable()) return leafTurn(kind, sign, ms, go, s);
    return sheetTurn(LEAF_KINDS.has(kind) ? 'slide' : kind, sign, ms, go, s);
  }).finally(() => schedulePrepare());
}

// ---------- leaf turns (WebGL) ----------
function leafSetup(s, sign) {
  const L = R.layout;
  const spread = L?.cols === 2;
  const W = s.W, H = s.H;
  const spine = spread ? Math.round(L.padX + L.width / 2) : 0;
  const base = { image: s.bitmap, W, H, cap: { x: 0, y: 0, w: W, h: H }, ...themeColors() };
  if (spread && sign > 0) return { ...base, hinge: spine, side: 1, leaf: { w: W - spine, top: 0, h: H }, still: [0, spine], landsOnPage: true };
  if (spread) return { ...base, hinge: spine, side: -1, leaf: { w: spine, top: 0, h: H }, still: [spine, W], landsOnPage: true };
  if (sign > 0) return { ...base, hinge: 0, side: 1, leaf: { w: W, top: 0, h: H }, still: null, landsOnPage: false };
  // single page, going back: the previous page comes back down over this one
  // (drawn entirely in WebGL so the arriving page can cut through the old one)
  return { ...base, hinge: 0, side: 1, leaf: { w: W, top: 0, h: H }, still: null, stillInGL: [0, W], frontLive: true, reverse: true };
}

const clipFor = (still, W) => (still ? `inset(0 ${W - still[1]}px 0 ${still[0]}px)` : 'inset(0 0 0 100%)');

// The back of the leaf gives way to the real page underneath as it lands
// (the back of the sheet *is* that page).
function backAlpha(setup, t) {
  if (setup.reverse) return 1;
  return 1 - smooth(setup.landsOnPage ? 0.86 : 0.9, 1, t);
}

async function leafTurn(kind, sign, ms, go, s) {
  const e = curlEngine();
  const setup = leafSetup(s, sign);
  if (!e.begin(setup)) return go();
  const rigid = kind === 'flip';
  const angle = rigid ? 0 : 0.24;
  const at = (x) => (setup.reverse ? 1 - x : x);
  const frame = (t) => e.draw(t, angle, { backAlpha: backAlpha(setup, t), rigid });
  if (setup.still) showSnap(s, clipFor(setup.still, s.W));
  frame(at(0));
  e.show(true);
  await go();
  await settled();
  const duration = Math.min(1400, Math.max(420, ms * 2.2));
  const ease = rigid ? flipEase : curlEase;
  await run(duration, (x) => frame(at(ease(x))), true);
  await finish(e);
}

// The last frame is (almost) the live page; fade what is left of the layers
// over a few frames instead of cutting.
async function finish(e) {
  const els = [e?.canvas, e?.shadowCanvas, snapEl].filter((x) => x && !x.hidden);
  await Promise.all(els.map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: 'linear', fill: 'forwards' }).finished.catch(() => {})));
  e?.end();
  hideSnap();
  els.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
}

// Adaptive quality: if frames come slowly, the next turns draw the moving
// page at a lower resolution (it is in motion, so this is hard to see).
const QUALITY = [1, 0.85, 0.72, 0.6, 0.5];
let qualityStep = 0;
function adapt(intervals) {
  if (intervals.length < 6 || !engine) return;
  const s = [...intervals].sort((a, b) => a - b);
  const median = s[Math.floor(s.length / 2)];
  if (median > 26 && qualityStep < QUALITY.length - 1) qualityStep++;
  else if (median < 18 && qualityStep > 0) qualityStep--;
  engine.quality = QUALITY[qualityStep];
}

function run(duration, frame, measure = false) {
  return new Promise((resolve) => {
    const start = performance.now();
    const gaps = [];
    let last = start;
    const tick = (now) => {
      gaps.push(now - last);
      last = now;
      const x = hurry ? 1 : Math.min(1, (now - start) / duration);
      frame(x);
      if (x < 1) requestAnimationFrame(tick);
      else { if (measure && !hurry) adapt(gaps.slice(1)); resolve(); }
    };
    requestAnimationFrame(tick);
  });
}

// ---------- dragging the corner ----------
// Returns a controller, or null if the curl can't run. The book moves to the
// new page as soon as the drag starts (under the snapshot); if the reader
// lets go without turning, it moves back.
export async function startDrag({ sign, y, go, undo }) {
  if (!webglAvailable() || overlayCovering()) return null;
  hurry = false;
  let release;
  const done = new Promise((r) => { release = r; });
  animation(() => done); // background work waits until the drag is over
  const s = await currentSnapshot();
  const e = curlEngine();
  const setup = s && leafSetup(s, sign);
  if (!s || !e.begin(setup)) { release(); return null; }
  const stageTop = $('#stage').getBoundingClientRect().top;
  const stageLeft = $('#stage').getBoundingClientRect().left;
  const angleFor = (py) => Math.max(-0.5, Math.min(0.5, ((py - stageTop) / setup.leaf.h - 0.5) * 1.1));
  let angle = angleFor(y);
  let q = 0, q0 = null;
  const draw = () => {
    const t = setup.reverse ? 1 - q : q;
    e.draw(t, angle, { backAlpha: backAlpha(setup, t) });
  };
  if (setup.still) showSnap(s, clipFor(setup.still, s.W));
  draw();
  e.show(true);
  await go();
  let last = { x: 0, time: performance.now() }, vel = 0;
  let pending = null;
  const flushMove = () => {
    if (!pending) return;
    const [px, py] = pending;
    pending = null;
    angle = angleFor(py) * (1 - q * 0.4);
    const local = (px - stageLeft - setup.hinge) * setup.side;
    const t = e.tForEdge(Math.min(local, setup.leaf.w - 1), angle);
    q = setup.reverse ? 1 - t : t;
    if (q0 == null) q0 = q;
    draw();
  };
  return {
    move(px, py) {
      const now = performance.now();
      vel = (((last.x - px) * sign) / Math.max(1, now - last.time)) * 0.6 + vel * 0.4;
      last = { x: px, time: now };
      // draw at most once per frame however fast the pointer reports
      if (!pending) requestAnimationFrame(flushMove);
      pending = [px, py];
    },
    async release() {
      flushMove();
      const moved = q - (q0 ?? 0);
      const finishTurn = q > 0.55 || moved > 0.28 || (vel > 0.35 && moved > 0.03);
      const from = q, to = finishTurn ? 1 : 0;
      const duration = Math.max(180, Math.abs(to - from) * 620);
      const a0 = angle;
      await run(duration, (x) => {
        const k = releaseEase(x);
        q = from + (to - from) * k;
        angle = a0 * (1 - k);
        draw();
      });
      if (!finishTurn) { await undo(); await settled(); }
      await finish(e);
      release();
      schedulePrepare();
      return finishTurn;
    },
  };
}

// ---------- sheet turns ----------
// Only the snapshot (and, for some, the live book) move, by transform and
// opacity — the compositor handles that without repainting anything.
async function sheetTurn(kind, sign, ms, go, s) {
  const c = showSnap(s);
  const viewer = $('#viewer');
  await go();
  await settled();
  const d = Math.max(180, ms * 1.25);
  const ease = 'cubic-bezier(.25,.8,.25,1)';
  const plans = {
    fade: { out: [{ opacity: 1 }, { opacity: 0 }] },
    slide: {
      out: [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-sign * 4}%)`, opacity: 0 }],
      in: [{ transform: `translateX(${sign * 4}%)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }],
    },
    push: {
      out: [{ transform: 'translateX(0)' }, { transform: `translateX(${-sign * 100}%)` }],
      in: [{ transform: `translateX(${sign * 100}%)` }, { transform: 'translateX(0)' }], k: 1.3,
    },
    zoom: {
      out: [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.05)', opacity: 0 }],
      in: [{ transform: 'scale(.98)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }],
    },
    rise: {
      out: [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-sign * 3}%)`, opacity: 0 }],
      in: [{ transform: `translateY(${sign * 3}%)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
    },
    cover: sign > 0
      ? { out: [{ transform: 'translateX(0)' }, { transform: 'translateX(-102%)' }], k: 1.3, cls: 'shadowed' }
      // going back, the previous page slides in over this one: the old page
      // is uncovered from the left behind a moving shadowed edge
      : { out: [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }], k: 1.3, edge: true },
  };
  const plan = plans[kind] || plans.slide;
  const dur = d * (plan.k || 1);
  const anims = [];
  if (plan.cls) c.classList.add(plan.cls);
  anims.push(c.animate(plan.out, { duration: dur, easing: ease, fill: 'forwards' }));
  if (plan.in) anims.push(viewer.animate(plan.in, { duration: dur, easing: ease }));
  let edge = null;
  if (plan.edge) {
    edge = document.createElement('div');
    edge.className = 'turn-edge-line';
    $('#stage').append(edge);
    anims.push(edge.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${s.W}px)` }], { duration: dur, easing: ease, fill: 'forwards' }));
  }
  const watch = setInterval(() => { if (hurry) anims.forEach((a) => a.finish()); }, 16);
  await Promise.all(anims.map((a) => a.finished.catch(() => {})));
  clearInterval(watch);
  anims.forEach((a) => a.cancel());
  c.classList.remove('shadowed');
  edge?.remove();
  hideSnap();
}

export { Curl };
