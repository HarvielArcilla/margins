// Page-turn animations.
//
// Every animation starts from a photo of the window as it is, then moves the
// real book to its new page underneath and animates the photo away, so the
// old and new pages are both on screen and nothing ever goes blank.
//
// Two families:
//  - Sheet animations (slide, push, fade, zoom, rise, cover) move what is on
//    screen as one sheet, whether that is one page or a two-page spread.
//  - Leaf animations (curl, flip) turn one page around its hinge, drawn in
//    WebGL (curl.js). In a two-page spread the hinge is the spine: going
//    forward the right-hand page turns over onto the left; going back the
//    left-hand page turns over onto the right. With a single page the page
//    turns away from its left edge, or (going back) the previous page comes
//    back down over it.
import { $ } from './ui.js';
import { getSettings } from './settings.js';
import { R } from './reader.js';
import { Curl } from './curl.js';

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

const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;

// Set when another turn is requested mid-animation: the running animation
// jumps to its end so rapid turning never lags behind the reader.
let hurry = false;
export function hurryUp() { hurry = true; }

let engine = null;
function curlEngine() {
  if (!engine) engine = new Curl($('#reader-view'));
  return engine;
}
export function webglAvailable() { return curlEngine().ok; }

// ---------- capturing ----------
function region() {
  const rv = $('#reader-view');
  const W = rv.clientWidth, H = rv.clientHeight;
  const tb = $('#reader-topbar');
  const topbarShown = +getComputedStyle(tb).opacity > 0.5;
  const top = topbarShown ? $('#stage').getBoundingClientRect().top : 0;
  return { W, H, top };
}

async function capture() {
  const g = region();
  const t0 = performance.now();
  let url = null;
  try { url = await window.api.window.capture({ x: 0, y: g.top, width: g.W, height: g.H - g.top }); } catch { url = null; }
  if (!url) return null;
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { return null; }
  if (!img.naturalWidth) return null;
  return { ...g, img, url, ms: performance.now() - t0 };
}

// Where the hinge is: the spine of a spread, or the left edge of the window.
function geometry(g) {
  const L = R.layout;
  const spread = L?.cols === 2;
  const stage = $('#stage').getBoundingClientRect();
  const spine = spread ? Math.round(stage.left + L.padX + L.width / 2) : 0;
  return { spread, spine };
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

// ---------- the entry point ----------
// sign: +1 turn as "forward" visually (leaf from the right), -1 the reverse.
export async function animate(kind, sign, ms, go) {
  hurry = false;
  if (kind === 'none') return go();
  if (LEAF_KINDS.has(kind) && webglAvailable()) {
    await leafTurn(kind, sign, ms, go);
    return;
  }
  return sheetTurn(LEAF_KINDS.has(kind) ? 'slide' : kind, sign, ms, go);
}

// ---------- leaf turns (WebGL) ----------
function leafSetup(cap, sign) {
  const { spread, spine } = geometry(cap);
  const { W, H, top } = cap;
  const base = { image: cap.img, W, H, cap: { x: 0, y: top, w: W, h: H - top }, ...themeColors() };
  if (spread && sign > 0) return { ...base, hinge: spine, side: 1, leaf: { w: W - spine, top, h: H - top }, stat: [0, spine], reverse: false, landsOnPage: true };
  if (spread) return { ...base, hinge: spine, side: -1, leaf: { w: spine, top, h: H - top }, stat: [spine, W], reverse: false, landsOnPage: true };
  if (sign > 0) return { ...base, hinge: 0, side: 1, leaf: { w: W, top, h: H - top }, stat: [0, 0], reverse: false, landsOnPage: false };
  // single page, going back: the previous page comes back down over this one
  return { ...base, hinge: 0, side: 1, leaf: { w: W, top, h: H - top }, stat: [0, W], frontLive: true, reverse: true, landsOnPage: false };
}

// Opacity of the back of the leaf: as it lands on the other page it gives
// way to the real page underneath (which is what the back of the paper is).
function backAlpha(setup, t) {
  // (fully opaque until then: some compositors exaggerate any transparency)
  if (setup.reverse) return 1;
  if (setup.landsOnPage) return 1 - smooth(0.9, 1, t);
  return 1 - smooth(0.92, 1, t);
}

async function leafTurn(kind, sign, ms, go) {
  const cap = await capture();
  if (!cap) { await go(); return true; }
  const e = curlEngine();
  const setup = leafSetup(cap, sign);
  if (!e.begin(setup)) { await go(); return true; }
  const rigid = kind === 'flip';
  const angle = rigid ? 0 : 0.26;
  const at = (x) => (setup.reverse ? 1 - x : x);
  e.draw(at(0), angle, { backAlpha: backAlpha(setup, at(0)), rigid });
  e.show(true);
  await go();
  await nextPaint();
  const duration = Math.min(1500, Math.max(380, ms * (rigid ? 2.1 : 2.5)));
  await run(duration, (x) => {
    const t = at(rigid ? easeInOut(x) : curlEase(x));
    e.draw(t, angle, { backAlpha: backAlpha(setup, t), rigid });
  });
  e.end();
  return true;
}

// The curl starts briskly (the corner lifts) and settles gently.
function curlEase(x) {
  return x < 0.5 ? 2.2 * x * x * (1.4 - 0.8 * x) : easeOut(x) * 0.98 + 0.02 * x;
}

function run(duration, frame) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const x = hurry ? 1 : Math.min(1, (now - start) / duration);
      frame(x);
      if (x < 1) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
}

// ---------- dragging the corner ----------
// Returns a controller, or null if the curl can't run. The book moves to the
// new page as soon as the drag starts (under the photo); if the reader lets
// go without turning, it moves back.
export async function startDrag({ sign, x, y, go, undo }) {
  if (!webglAvailable()) return null;
  hurry = false;
  const cap = await capture();
  if (!cap) return null;
  const e = curlEngine();
  const setup = leafSetup(cap, sign);
  if (!e.begin(setup)) return null;
  const leafH = setup.leaf.h;
  const angleFor = (py) => Math.max(-0.5, Math.min(0.5, ((py - setup.leaf.top) / leafH - 0.5) * 1.1));
  let angle = angleFor(y);
  let q = 0; // how far through the turn the pointer has taken it, 0..1
  let q0 = null; // where the first move put it
  const draw = () => {
    const t = setup.reverse ? 1 - q : q;
    e.draw(t, angle, { backAlpha: backAlpha(setup, t) });
  };
  draw();
  e.show(true);
  await go();
  let last = { x, time: performance.now() }, vel = 0;
  return {
    move(px, py) {
      // keep the page's free edge under the pointer
      angle = angleFor(py) * (1 - q * 0.4);
      const local = (px - setup.hinge) * setup.side;
      const t = e.tForEdge(Math.min(local, setup.leaf.w - 1), angle);
      q = setup.reverse ? 1 - t : t;
      if (q0 == null) q0 = q;
      const now = performance.now();
      vel = (((last.x - px) * sign) / Math.max(1, now - last.time)) * 0.6 + vel * 0.4;
      last = { x: px, time: now };
      draw();
    },
    async release() {
      const moved = q - (q0 ?? 0);
      const finish = q > 0.55 || moved > 0.28 || (vel > 0.35 && moved > 0.03);
      const from = q, to = finish ? 1 : 0;
      const duration = Math.max(160, Math.abs(to - from) * 650);
      const a0 = angle;
      await run(duration, (x) => {
        q = from + (to - from) * easeOut(x);
        angle = a0 * (1 - easeOut(x));
        draw();
      });
      if (!finish) { await undo(); await nextPaint(); }
      e.end();
      return finish;
    },
  };
}

// ---------- sheet turns ----------
async function sheetTurn(kind, sign, ms, go) {
  const cap = await capture();
  if (!cap) return go();
  const { W, H, top } = cap;
  const rv = $('#reader-view');
  const sheet = document.createElement('div');
  sheet.className = 'turn-sheet';
  Object.assign(sheet.style, { top: `${top}px`, height: `${H - top}px`, backgroundImage: `url(${cap.url})`, backgroundSize: `${W}px ${H - top}px` });
  rv.append(sheet);
  await go();
  await nextPaint();
  const viewer = $('#viewer');
  const d = Math.max(160, ms * 1.25);
  const sx = sign; // visual direction (the caller accounts for right-to-left books)
  const ease = 'cubic-bezier(.25,.8,.25,1)';
  const plans = {
    fade: { out: [{ opacity: 1 }, { opacity: 0 }], d },
    slide: {
      out: [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-sx * 5}%)`, opacity: 0 }],
      in: [{ transform: `translateX(${sx * 5}%)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], d,
    },
    push: {
      out: [{ transform: 'translateX(0)' }, { transform: `translateX(${-sx * 100}%)` }],
      in: [{ transform: `translateX(${sx * 100}%)` }, { transform: 'translateX(0)' }], d: d * 1.3,
    },
    zoom: {
      out: [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.06)', opacity: 0 }],
      in: [{ transform: 'scale(.97)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], d,
    },
    rise: {
      out: [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-sx * 3}%)`, opacity: 0 }],
      in: [{ transform: `translateY(${sx * 3}%)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], d,
    },
    cover: sx > 0
      ? { out: [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], d: d * 1.3, shadow: true }
      // going back, the previous page slides in over this one: uncover it
      // from the left with the same shadowed edge
      : { out: [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }], d: d * 1.3, edge: true },
  };
  const plan = plans[kind] || plans.slide;
  if (plan.shadow) sheet.classList.add('shadowed');
  let edge = null;
  if (plan.edge) { edge = document.createElement('div'); edge.className = 'turn-edge-line'; Object.assign(edge.style, { top: `${top}px`, height: `${H - top}px` }); rv.append(edge); }
  const anims = [sheet.animate(plan.out, { duration: plan.d, easing: ease, fill: 'forwards' })];
  if (plan.in) anims.push(viewer.animate(plan.in, { duration: plan.d, easing: ease }));
  if (edge) anims.push(edge.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${W}px)` }], { duration: plan.d, easing: ease, fill: 'forwards' }));
  const watch = setInterval(() => { if (hurry) anims.forEach((a) => a.finish()); }, 16);
  await Promise.all(anims.map((a) => a.finished.catch(() => {})));
  clearInterval(watch);
  anims.forEach((a) => a.cancel());
  sheet.remove();
  edge?.remove();
}

export { Curl };
