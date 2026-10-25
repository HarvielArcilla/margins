// Page-turn animations.
//
// Every animation works from pictures of the page area (the stage, not the
// header or footer), made ahead of time as soon as a page has settled:
//   - the page on screen (a capture of the window, or from the pager when a
//     panel is floating over the page), and
//   - the pages before and after it, and one further each way, rendered by
//     the offscreen pager (a hidden window, see main.js) with the same
//     settings and size. They are kept by page, so after a turn the pictures
//     already in hand are reused.
// So a turn starts on the very next frame, the page arriving is already
// complete while it turns in (and is printed on the back of the turning
// leaf), and nothing depends on the real book finishing its own redraw —
// that happens underneath and the pictures fade away once it has.
//
// Layers inside the stage, above the live book:
//   .turn-under  – the arriving page (from the pager), drawn once.
//   .turn-snap   – the page being left, drawn once at full resolution. Sheet
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
import { $, toast } from './ui.js';
import { getSettings } from './settings.js';
import { R, liveContents } from './reader.js';
import { Curl } from './curl.js';
import { animation, isAnimating, idle, nextFrame, nextPaint, softwareRendering } from './perf.js';
import { all as allAnnotations } from './annotations.js';

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

let underEl = null;
function underLayer() {
  if (!underEl) {
    underEl = document.createElement('canvas');
    underEl.className = 'turn-under';
    underEl.hidden = true;
    $('#stage').append(underEl);
  }
  return underEl;
}

function showUnder(n) {
  const c = underLayer();
  if (c.width !== n.bitmap.width || c.height !== n.bitmap.height) { c.width = n.bitmap.width; c.height = n.bitmap.height; }
  c.getContext('2d', { alpha: false }).drawImage(n.bitmap, 0, 0);
  Object.assign(c.style, { width: `${n.W}px`, height: `${n.H}px`, opacity: '', transform: '' });
  c.hidden = false;
  return c;
}

function hideUnder() {
  if (!underEl) return;
  underEl.getAnimations().forEach((a) => a.cancel());
  underEl.hidden = true;
}

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

// ---------- page pictures ----------
// Pictures are kept by page (its start CFI) for one "look" of the book:
// anything that changes how pages look bumps the version and drops them all.
// `links` remember which page comes before or after which, as the pager
// found it, so a turn knows which picture is arriving.
let version = 0;
const pics = new Map();     // `${look}|${cfi}` → { bitmap, W, H, cfi, used }
const links = new Map();    // `${look}|${cfi}|next|prev` → cfi of that page, or null at the ends
const inflight = new Map(); // same keys → promise of a picture
const MAX_PICS = 9;

export function invalidate() {
  version++;
  pics.clear(); links.clear(); inflight.clear();
  schedulePrepare();
}

const look = () => `${R.meta?.id}|${version}|${$('#stage').clientWidth}x${$('#stage').clientHeight}`;
const here = () => R.location?.start?.cfi || null;
const dbg = (...a) => { if (window.__turnDebug) console.log(...a); };

function remember(cfi, shot) {
  if (!cfi || !shot) return shot;
  const p = { ...shot, cfi, used: performance.now() };
  pics.set(`${look()}|${cfi}`, p);
  if (pics.size > MAX_PICS) {
    // drop the least recently used, never the page on screen
    const keep = `${look()}|${here()}`;
    const old = [...pics.entries()].filter(([k]) => k !== keep).sort((a, b) => a[1].used - b[1].used)[0];
    if (old) pics.delete(old[0]);
  }
  return p;
}

function picture(cfi) {
  const p = cfi && pics.get(`${look()}|${cfi}`);
  if (p) p.used = performance.now();
  return p || null;
}

function overlayCovering() {
  // floating panels or popups over the page would end up in a window capture
  const b = document.body.classList;
  return b.contains('sidebar-open') || b.contains('settings-open') || !$('#sel-popup').hidden || !!document.querySelector('.modal-backdrop, .popup-menu');
}

function stageRect() {
  const r = $('#stage').getBoundingClientRect();
  return { left: Math.round(r.left), top: Math.round(r.top), W: Math.round(r.width), H: Math.round(r.height) };
}

// RGBA pixels from the main process → an ImageBitmap
async function toBitmap(raw, W, H) {
  if (!raw?.data?.length || raw.error) return null;
  const px = new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength);
  if (px.length !== raw.width * raw.height * 4) return null;
  if (raw.order === 'bgra') {
    const u = new Uint32Array(px.buffer, px.byteOffset, px.byteLength >> 2);
    for (let i = 0; i < u.length; i++) {
      const v = u[i];
      u[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >> 16) & 0xff);
    }
  }
  try {
    return { bitmap: await createImageBitmap(new ImageData(px, raw.width, raw.height)), W, H };
  } catch { return null; }
}

// A capture of the window: exact (search marks and all), and quick — but
// only usable when nothing is floating over the page.
let captureFailures = 0;
async function capture() {
  if (captureFailures >= 2 || window.__noCapture || overlayCovering()) return null;
  const r = stageRect();
  if (r.W < 10 || r.H < 10) return null;
  let raw;
  try { raw = await window.api.window.captureRaw({ x: r.left, y: r.top, width: r.W, height: r.H }); } catch (e) { raw = { error: String(e) }; }
  const shot = await toBitmap(raw, r.W, r.H);
  if (shot) { captureFailures = 0; return shot; }
  captureFailures++;
  console.warn('window capture failed:', raw?.error || 'bad size', raw?.width, raw?.height, raw?.data?.length);
  return null;
}

// ---------- the pager: pages rendered in a hidden window ----------
function pagerSpec(which, cfi) {
  return {
    which, cfi,
    bookId: R.meta.id,
    s: getSettings(), theme: R.theme,
    L: R.layout,
    stage: stageRect(),
    win: { W: window.innerWidth, H: window.innerHeight },
    items: allAnnotations(),
  };
}

async function renderWithPager(which, cfi) {
  if (!R.open || !cfi || !R.layout || getSettings().flow !== 'paginated') return null;
  const spec = pagerSpec(which, cfi);
  let raw;
  try { raw = await window.api.pager.render(spec); } catch (e) { raw = { ok: false, error: String(e) }; }
  if (!raw?.ok) { if (raw?.error) console.warn('pager:', raw.error); return null; }
  const shot = await toBitmap(raw, spec.stage.W, spec.stage.H);
  return shot && { ...shot, cfi: raw.cfi };
}

// The picture of the page before or after `cfi`: from memory, or rendered.
function neighbour(cfi, which) {
  const lk = `${look()}|${cfi}|${which}`;
  if (links.has(lk)) {
    const to = links.get(lk);
    const p = to && picture(to);
    if (p || !to) return Promise.resolve(p);
  }
  if (inflight.has(lk)) return inflight.get(lk);
  const l0 = look();
  const job = (async () => {
    const t0 = performance.now();
    const n = await renderWithPager(which, cfi);
    dbg('render', which, cfi, '→', n?.cfi, Math.round(performance.now() - t0));
    if (look() !== l0) return null;
    if (!n) return null;
    // at either end of the book the pager stays where it was
    if (n.cfi === cfi) { links.set(lk, null); return null; }
    links.set(lk, n.cfi);
    links.set(`${l0}|${n.cfi}|${which === 'next' ? 'prev' : 'next'}`, cfi);
    return remember(n.cfi, n);
  })().finally(() => inflight.delete(lk));
  inflight.set(lk, job);
  return job;
}

// Known right now, without waiting?
function knownNeighbour(cfi, which) {
  const to = links.get(`${look()}|${cfi}|${which}`);
  return to ? picture(to) : null;
}

// The page on screen.
async function currentPicture() {
  const cfi = here();
  const known = picture(cfi);
  if (known) return known;
  const shot = (await capture()) || (await renderWithPager('current', cfi));
  if (!shot) return null;
  return here() === cfi ? remember(cfi, shot) : { ...shot, cfi };
}

// ---------- getting ready between turns ----------
// As soon as a page settles: its own picture, then the pages either side,
// then one further each way, so turning steadily never waits for a render.
let prepTimer = 0;
let preparing = false;
export function schedulePrepare(delay = 160) {
  clearTimeout(prepTimer);
  prepTimer = setTimeout(prepare, delay);
}

async function prepare() {
  const s = getSettings();
  if (!R.open || s.flow !== 'paginated' || s.pageAnimation === 'none') return;
  if (preparing || isAnimating()) { schedulePrepare(250); return; }
  preparing = true;
  try {
    await idle(300);
    const cfi = here(), l0 = look();
    const stale = () => !R.open || here() !== cfi || look() !== l0;
    if (!cfi || isAnimating()) { schedulePrepare(250); return; }
    dbg('prepare', cfi, l0);
    await document.fonts?.ready;
    if (!picture(cfi)) {
      await nextPaint();
      if (stale()) return;
      await currentPicture();
    }
    const cur = picture(cfi);
    if (cur && LEAF_KINDS.has(getSettings().pageAnimation)) curlEngine().setImage(cur.bitmap);
    const atEnd = !!R.location?.atEnd, atStart = !!R.location?.atStart;
    const near = [];
    if (!atEnd) near.push(['next', cfi]);
    if (!atStart) near.push(['prev', cfi]);
    for (const [which, from] of near) {
      if (stale()) return;
      if (isAnimating()) { schedulePrepare(250); return; }
      await neighbour(from, which);
    }
    // one further each way
    for (const which of ['next', 'prev']) {
      if (stale()) return;
      if (isAnimating()) { schedulePrepare(250); return; }
      const mid = links.get(`${look()}|${cfi}|${which}`);
      if (mid) { await idle(300); if (!stale()) await neighbour(mid, which); }
    }
  } finally {
    preparing = false;
  }
}

function showSnap(s, clip = null) {
  const c = snapLayer();
  if (c.width !== s.bitmap.width || c.height !== s.bitmap.height) { c.width = s.bitmap.width; c.height = s.bitmap.height; }
  c.getContext('2d', { alpha: false }).drawImage(s.bitmap, 0, 0);
  Object.assign(c.style, { width: `${s.W}px`, height: `${s.H}px`, clipPath: clip || '', opacity: '', transform: '' });
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

// Waits until the page the book just moved to has been drawn.
async function settled() {
  await nextPaint();
  await document.fonts?.ready;
  await nextFrame();
}

// Stricter, for taking the pictures away: the book has to be on the
// expected page, with its fonts loaded and a quiet moment to lay out and
// paint — the reader is looking at an exact picture meanwhile, so there is
// no hurry, and revealing a half-drawn page is what makes text flicker.
async function liveReady(cfi) {
  const t0 = performance.now();
  for (;;) {
    let cur = null;
    try { cur = R.rendition?.currentLocation()?.start?.cfi; } catch { /* busy */ }
    if (!cfi || cur === cfi || performance.now() - t0 > 700) break;
    await nextFrame();
  }
  await document.fonts?.ready;
  for (const c of liveContents()) { try { await c.document?.fonts?.ready; } catch { /* gone */ } }
  if (!hurry) await Promise.race([idle(160), new Promise((r) => setTimeout(r, 160))]);
  await nextPaint();
  await nextFrame();
}

// After `go()`: is the book really on the page this picture shows?
function onPage(p) {
  if (!p) return false;
  let cfi = null;
  try { cfi = R.rendition.currentLocation()?.start?.cfi; } catch { /* not ready */ }
  return cfi === p.cfi;
}

// ---------- the entry point ----------
// sign: +1 for a turn that moves visually leftward (forward in left-to-right
// books), -1 for the reverse. dir: +1 forward in reading order, -1 back.
let warned = false;
export async function animate(kind, sign, ms, go, dir = sign) {
  hurry = false;
  if (kind === 'none') return go();
  // nothing to turn to at either end of the book
  if ((dir > 0 && R.location?.atEnd) || (dir < 0 && R.location?.atStart)) return go();
  const which = dir > 0 ? 'next' : 'prev';
  dbg('turn', kind, which);
  return animation(async () => {
    const cfi = here();
    const s = await currentPicture();
    if (!s) {
      if (!warned) {
        warned = true;
        console.warn('page-turn pictures unavailable; using simple animations');
        toast('Couldn’t picture the page, so page turns are simplified for now.', 3200);
      }
      return liveTurn(kind, sign, ms, go);
    }
    // the arriving page: in memory already, or on its way (and swapped in
    // the moment it arrives)
    const ctx = { which, cfi, n: knownNeighbour(cfi, which), coming: null };
    if (!ctx.n) ctx.coming = neighbour(cfi, which);
    dbg('arriving known', !!ctx.n, cfi, look());
    if (LEAF_KINDS.has(kind) && webglAvailable()) await leafTurn(kind, sign, ms, go, s, ctx);
    else await sheetTurn(LEAF_KINDS.has(kind) ? 'slide' : kind, sign, ms, go, s, ctx);
  }).finally(() => schedulePrepare());
}

// The arriving picture, once the book has moved: checks it is the right page.
function arrivingNow(ctx) {
  if (ctx.n && !onPage(ctx.n)) ctx.n = null;
  return ctx.n;
}

// Calls `use(picture)` if the arriving page turns up while still turning.
function whenArrives(ctx, use) {
  if (ctx.n || !ctx.coming) return;
  ctx.coming.then((p) => {
    if (!p || ctx.done || !onPage(p)) return;
    ctx.n = p;
    dbg('arrived mid-turn');
    use(p);
  });
}

// Without any pictures: move the live book itself out, turn, and in again.
async function liveTurn(kind, sign, ms, go) {
  const viewer = $('#viewer');
  const half = Math.max(110, ms * 0.6);
  const out = kind === 'fade' || kind === 'zoom' ? [{ opacity: 1 }, { opacity: 0 }]
    : [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-sign * 3}%)`, opacity: 0 }];
  const inn = kind === 'fade' || kind === 'zoom' ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ transform: `translateX(${sign * 3}%)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }];
  const a = viewer.animate(out, { duration: half, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
  await a.finished.catch(() => {});
  await go();
  await settled();
  a.cancel();
  await viewer.animate(inn, { duration: half, easing: 'cubic-bezier(.25,.8,.25,1)' }).finished.catch(() => {});
}

// ---------- leaf turns (WebGL) ----------
// Which part turns, and what is printed on each side:
//   spread forward  – the right page turns onto the left; its back is the
//                     next spread's left page; underneath is the next spread
//   spread back     – the left page turns onto the right; its back is the
//                     previous spread's right page
//   single forward  – the page turns away from its left edge
//   single back     – the previous page comes back down over this one
function leafSetup(s, sign, n) {
  const L = R.layout;
  const spread = L?.cols === 2;
  const W = s.W, H = s.H;
  const spine = spread ? Math.round(L.padX + L.width / 2) : 0;
  const base = { image: s.bitmap, W, H, cap: { x: 0, y: 0, w: W, h: H }, ...themeColors() };
  if (spread && sign > 0) return { ...base, back: n?.bitmap, under: n, hinge: spine, side: 1, leaf: { w: W - spine, top: 0, h: H }, still: [0, spine], landsOnPage: true };
  if (spread) return { ...base, back: n?.bitmap, under: n, hinge: spine, side: -1, leaf: { w: spine, top: 0, h: H }, still: [spine, W], landsOnPage: true };
  if (sign > 0) return { ...base, under: n, hinge: 0, side: 1, leaf: { w: W, top: 0, h: H }, still: null, landsOnPage: false };
  if (n) {
    // the previous page is known: it is the leaf, coming down over the old
    // page, which stays in place underneath
    return { ...base, image: n.bitmap, hinge: 0, side: 1, leaf: { w: W, top: 0, h: H }, still: [0, W], reverse: true };
  }
  // previous page unknown: drawn as blank paper landing, cut through to the
  // live page (all in WebGL)
  return { ...base, hinge: 0, side: 1, leaf: { w: W, top: 0, h: H }, still: null, stillInGL: [0, W], frontLive: true, reverse: true };
}

const clipFor = (still, W) => (still ? `inset(0 ${W - still[1]}px 0 ${still[0]}px)` : 'inset(0 0 0 100%)');

// The back of the leaf gives way to the real page underneath as it lands
// (the back of the sheet *is* that page).
function backAlpha(setup, t) {
  if (setup.reverse || setup.back) return 1;
  return 1 - smooth(setup.landsOnPage ? 0.86 : 0.9, 1, t);
}

// Without a picture of the arriving page, the leaf lands as plain paper and
// gives way to the live page — and so must the old page it lands on.
function fadeStill(setup, a) {
  if (setup.still && !setup.back && !setup.reverse && snapEl) snapEl.style.opacity = a < 1 ? String(a) : '';
}

async function leafTurn(kind, sign, ms, go, s, ctx) {
  const e = curlEngine();
  const rigid = kind === 'flip';
  const angle = rigid ? 0 : 0.24;
  // first frame: just the old page, then the book moves underneath it
  showSnap(s);
  await nextFrame();
  await go();
  const n = arrivingNow(ctx);
  const setup = leafSetup(s, sign, n);
  if (!e.begin(setup)) { ctx.done = true; await liveReady(n?.cfi); hideSnap(); return; }
  let t = 0;
  const at = (x) => (setup.reverse ? 1 - x : x);
  const frame = (tt) => { t = tt; const a = backAlpha(setup, tt); fadeStill(setup, a); e.draw(tt, angle, { backAlpha: a, rigid }); };
  if (setup.under) showUnder(setup.under);
  if (setup.still) showSnap(s, clipFor(setup.still, s.W)); else hideSnap();
  frame(at(0));
  e.show(true);
  if (!n) {
    whenArrives(ctx, (p) => {
      // under the leaf it is invisible to swap; on the back only while the
      // back has not come into view yet
      if (setup.reverse) return;
      setup.under = p;
      showUnder(p);
      if (setup.landsOnPage && t < 0.2) { setup.back = p.bitmap; e.setBack(p.bitmap); }
    });
  }
  const duration = Math.min(1400, Math.max(420, ms * 2.2));
  const ease = rigid ? flipEase : curlEase;
  await run(duration, (x) => frame(at(ease(x))), true);
  ctx.done = true;
  await finish(e, { exact: !!setup.under || !!setup.back, cfi: here() });
}

// Once the book itself is ready underneath, the pictures go. If they were
// exact pictures of that page, they just go; otherwise they fade quickly.
async function finish(e, { leaf = !!e, exact = false, cfi = null } = {}) {
  await liveReady(cfi);
  // a landed leaf covers the old page it lies on
  if (leaf) hideSnap();
  const els = [e?.canvas, e?.shadowCanvas, snapEl, underEl].filter((x) => x && !x.hidden);
  if (!exact) await Promise.all(els.map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: 'linear', fill: 'forwards' }).finished.catch(() => {})));
  e?.end();
  hideSnap();
  hideUnder();
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
export async function startDrag({ sign, dir = sign, y, go, undo }) {
  if (!webglAvailable()) return null;
  if ((dir > 0 && R.location?.atEnd) || (dir < 0 && R.location?.atStart)) return null;
  hurry = false;
  let release;
  const done = new Promise((r) => { release = r; });
  animation(() => done); // background work waits until the drag is over
  const cfi = here();
  const s = await currentPicture();
  const e = curlEngine();
  if (!s) { release(); return null; }
  const ctx = { which: dir > 0 ? 'next' : 'prev', cfi, n: null };
  ctx.n = knownNeighbour(cfi, ctx.which);
  if (!ctx.n) ctx.coming = neighbour(cfi, ctx.which);
  showSnap(s);
  await nextFrame();
  await go();
  const setup = leafSetup(s, sign, arrivingNow(ctx));
  if (!e.begin(setup)) { await undo(); hideSnap(); release(); return null; }
  const stageTop = $('#stage').getBoundingClientRect().top;
  const stageLeft = $('#stage').getBoundingClientRect().left;
  const angleFor = (py) => Math.max(-0.5, Math.min(0.5, ((py - stageTop) / setup.leaf.h - 0.5) * 1.1));
  let angle = angleFor(y);
  let q = 0, q0 = null;
  const draw = () => {
    const t = setup.reverse ? 1 - q : q;
    const a = backAlpha(setup, t);
    fadeStill(setup, a);
    e.draw(t, angle, { backAlpha: a });
  };
  if (setup.under) showUnder(setup.under);
  if (setup.still) showSnap(s, clipFor(setup.still, s.W)); else hideSnap();
  draw();
  e.show(true);
  whenArrives(ctx, (p) => {
    if (setup.reverse) return;
    setup.under = p;
    showUnder(p);
    if (setup.landsOnPage && q < 0.2) { setup.back = p.bitmap; e.setBack(p.bitmap); }
  });
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
      ctx.done = true;
      if (!finishTurn) { await undo(); await liveReady(cfi); hideUnder(); }
      await finish(e, { leaf: finishTurn, exact: finishTurn ? !!(setup.under || setup.back) : true, cfi: finishTurn ? ctx.n?.cfi || here() : cfi });
      release();
      schedulePrepare();
      return finishTurn;
    },
  };
}

// ---------- sheet turns ----------
// Only the snapshot (and, for some, the live book) move, by transform and
// opacity — the compositor handles that without repainting anything.
async function sheetTurn(kind, sign, ms, go, s, ctx) {
  const c = showSnap(s);
  await nextFrame();
  await go();
  // the arriving page: its picture if there is one, else the live book —
  // swapped for the picture if it turns up during the turn
  const n = arrivingNow(ctx);
  let incoming = n ? showUnder(n) : $('#viewer');
  if (!n) await settled();
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
  let inAnim = plan.in ? incoming.animate(plan.in, { duration: dur, easing: ease, fill: 'forwards' }) : null;
  if (inAnim) anims.push(inAnim);
  if (!n) {
    whenArrives(ctx, (p) => {
      // the picture takes over from the live book in the same place
      const u = showUnder(p);
      if (inAnim) {
        const a = u.animate(plan.in, { duration: dur, easing: ease, fill: 'forwards' });
        a.currentTime = inAnim.currentTime;
        anims.push(a);
        a.finished.catch(() => {});
      }
    });
  }
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
  ctx.done = true;
  c.classList.remove('shadowed');
  edge?.remove();
  hideSnap();
  if (ctx.n) {
    // the picture stays, still, until the book under it is ready
    await finish(null, { exact: true, cfi: ctx.n.cfi });
    $('#viewer').getAnimations().forEach((a) => a.cancel());
  } else {
    await liveReady(here());
    $('#viewer').getAnimations().forEach((a) => a.cancel());
    hideUnder();
  }
  anims.forEach((a) => a.cancel());
}

export { Curl };
