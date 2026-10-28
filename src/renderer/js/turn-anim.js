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
import { coverBox, measure } from './cover.js';
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
// Is a page visibly moving right now? (Afterwards a turn can still be busy
// a moment, waiting for the book underneath to be ready to show.)
let motion = false;
export const inMotion = () => motion;
// Another turn asked for while one runs: the running one stops where it is
// (the book is already on its new page underneath) and the next follows at
// once.
export function hurryUp() {
  hurry = true;
  // a cover opening or closing stops too
  if (rig) for (const el of [rig, ...rig.querySelectorAll('*'), $('#stage'), $('#spine')]) el?.getAnimations().forEach((x) => x.finish());
}

// ---------- layers ----------
let engine = null;
function curlEngine() {
  if (!engine) {
    // The turning page is drawn in a layer over the page area and the desk
    // around it, so it can lift past the page's edges.
    let over = $('#turn-over');
    if (!over) { over = document.createElement('div'); over.id = 'turn-over'; $('#reader-view').append(over); }
    engine = new Curl(over, { soft: softwareRendering() });
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
  // (with rounded page corners the capture has a little desk in each
  // corner; everything that draws a picture rounds those corners off again)
  if (captureFailures >= 2 || window.__noCapture || overlayCovering()) return null;
  const r = stageRect();
  if (r.W < 10 || r.H < 10) return null;
  let raw;
  try { raw = await window.api.window.captureRaw({ x: r.left, y: r.top, width: r.W, height: r.H }); } catch (e) { raw = { error: String(e) }; }
  const shot = await toBitmap(raw, r.W, r.H);
  if (shot) { captureFailures = 0; pictureStatus.capture = 'working'; return shot; }
  captureFailures++;
  pictureStatus.capture = `failed: ${raw?.error || `unexpected size ${raw?.width}×${raw?.height}`}`;
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
    dpr: window.devicePixelRatio || 1,
    items: allAnnotations(),
    gen: R.jumpGen || 0,
  };
}

async function renderWithPager(which, cfi) {
  if (!R.open || !cfi || !R.layout || getSettings().flow !== 'paginated') return null;
  if (window.__noPager) { pictureStatus.pager = 'failed: switched off for testing'; return null; }
  const spec = pagerSpec(which, cfi);
  let raw;
  try { raw = await window.api.pager.render(spec); } catch (e) { raw = { ok: false, error: String(e) }; }
  if (raw?.stale) return null; // the reader has jumped elsewhere since
  if (!raw?.ok) {
    if (raw?.error) console.warn('pager:', raw.error);
    pictureStatus.pager = `failed: ${raw?.error || 'no reply'}`;
    return null;
  }
  const shot = await toBitmap(raw, spec.stage.W, spec.stage.H);
  pictureStatus.pager = shot ? 'working' : `failed: unexpected size ${raw.width}×${raw.height}`;
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
let hurryPrep = false;
export function schedulePrepare(delay = 160, { soon = false } = {}) {
  clearTimeout(prepTimer);
  if (soon) hurryPrep = true;
  prepTimer = setTimeout(prepare, delay);
}

async function prepare() {
  const s = getSettings();
  if (!R.open || s.flow !== 'paginated' || s.pageAnimation === 'none') return;
  if (preparing || isAnimating()) { schedulePrepare(250); return; }
  preparing = true;
  try {
    // after a jump the next turn is likely soon: no waiting for a quiet moment
    if (hurryPrep) hurryPrep = false; else await idle(300);
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
export async function animate(kind, sign, ms, go, dir = sign, at = null) {
  hurry = false;
  clickedAt = at;
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
    if (!ctx.n) {
      ctx.coming = neighbour(cfi, which);
      // Not ready (just after a jump, say): worth a short wait, rather than
      // starting the turn without the page underneath and swapping it in
      // halfway through.
      const got = await Promise.race([ctx.coming, new Promise((r) => setTimeout(() => r(null), 450))]);
      if (got) ctx.n = got;
    }
    dbg('arriving known', !!ctx.n, cfi, look());
    if (LEAF_KINDS.has(kind) && webglAvailable()) await leafTurn(kind, sign, ms, go, s, ctx);
    else await sheetTurn(LEAF_KINDS.has(kind) ? 'slide' : kind, sign, ms, go, s, ctx);
  }).finally(() => { motion = false; schedulePrepare(); });
}

// ---------- opening and closing the covers ----------
// As a real book opens and closes, with the page under a cover there from
// the start.
// - Two pages across: a cover swings about the spine. The front cover lies
//   right of the spine and comes down on the left as the inside of the
//   cover, the blank page facing page 1; the back cover lies left of it and
//   comes down on the right as the blank page facing the last page. Nothing
//   shows on that side until it lands.
// - One page: the cover lifts off the page, which lies under it at the
//   cover's size, then the page opens out to fill the view.
// Arriving at a cover runs the same way back. (A cover isn't page-shaped,
// so the page curl and flip don't suit it.)
const coverFace = () => { const f = $('#stage.closed .cover-face'); return f && !f.hidden ? f : null; };

let rig = null; // the moving covers' holder while the book slides (see coverTurn)
function leafAt(rect, cls, origin) {
  const d = document.createElement('div');
  d.className = `cover-leaf ${cls}`;
  Object.assign(d.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, transformOrigin: origin });
  // inside the reader, so it takes the page's rounded corners
  (rig || $('#reader-view')).append(d);
  return d;
}
// The page's atmosphere (vignette, night light, dimming) lies over the
// pages; a leaf moves over it, so it carries its own copy, matched to where
// it lies (exact while flat, and turning with it as it lifts).
function withAtmosphere(d, rect) {
  const rv = $('#reader-view');
  const box = rv.getBoundingClientRect();
  const level = (k) => parseFloat(rv.style.getPropertyValue(`--fx-${k}`)) || 0;
  const add = (cls, style) => { const x = document.createElement('div'); x.className = `leaf-fx ${cls}`; Object.assign(x.style, style); d.append(x); };
  const vig = level('vignette');
  const vEl = rv.querySelector('.fx-vignette');
  if (vig > 0.001 && vEl) {
    add('leaf-vignette', {
      backgroundImage: getComputedStyle(vEl).backgroundImage, opacity: String(vig),
      backgroundSize: `${box.width}px ${box.height}px`, backgroundRepeat: 'no-repeat',
      backgroundPosition: `${box.left - rect.left}px ${box.top - rect.top}px`,
    });
  }
  if (level('warm') > 0.001) add('leaf-warm', { background: '#ff7a10', opacity: String(level('warm')) });
  if (level('dim') > 0.001) add('leaf-dim', { background: '#000', opacity: String(level('dim')) });
  return d;
}
function coverLeaf(rect, src, side) {
  const d = leafAt(rect, `cover-face${side === 'back' ? ' back' : ''}`, side === 'back' ? 'right center' : 'left center');
  const im = document.createElement('img');
  im.src = src;
  im.alt = '';
  d.append(im);
  return withAtmosphere(d, rect);
}
// the inside of a cover: a blank page, paper texture and all, like the page
// it becomes
function insideLeaf(rect, side) {
  const d = leafAt(rect, `cover-inside${side === 'back' ? ' back' : ''}`, side === 'back' ? 'left center' : 'right center');
  const paper = $('#paper');
  if (paper && !paper.hidden && paper.style.backgroundImage) {
    const t = document.createElement('div');
    t.className = 'cover-inside-paper';
    // lined up with the texture on the page it becomes
    const off = rect.left - $('#stage').getBoundingClientRect().left;
    Object.assign(t.style, { backgroundImage: paper.style.backgroundImage, backgroundSize: paper.style.backgroundSize, opacity: paper.style.opacity, backgroundPosition: `${-off}px 0` });
    d.append(t);
  }
  return withAtmosphere(d, rect);
}

// one quarter turn of a leaf about its hinge, darkening as it rises off
// the page and lightening as it comes down (0 = flat, ±90 = upright)
function quarter(el, from, to, dur, easing) {
  const tf = (a) => `perspective(2400px) rotateY(${a}deg)`;
  const shade = (a) => `brightness(${1 - 0.28 * Math.abs(Math.sin((a * Math.PI) / 180))})`;
  return el.animate([{ transform: tf(from), filter: shade(from) }, { transform: tf(to), filter: shade(to) }],
    { duration: hurry ? 1 : dur, easing, fill: 'forwards' }).finished.catch(() => {});
}
const RISE = 'cubic-bezier(.45,0,.9,.6)';
const LAND = 'cubic-bezier(.1,.4,.55,1)';

export async function coverTurn({ side, toCover }, ms, go) {
  hurry = false;
  const stage = $('#stage');
  const rv = $('#reader-view');
  const dur = Math.max(520, ms * 1.4);
  const spread = R.cols === 2;
  const m = side === 'back' ? -1 : 1; // the back cover turns the other way
  const radius = parseFloat(getComputedStyle(rv).getPropertyValue('--page-radius')) || 0;
  const R3 = radius || 3;
  const leaves = [];
  const sr = () => stage.getBoundingClientRect();
  const screenRect = (b) => { const s = sr(); return { left: s.left + b.left, top: s.top + b.top, width: b.width, height: b.height }; };
  // the half of the spread the cover lies on, and the other half
  const half = (which) => { const s = sr(); return { left: which === 'right' ? s.left + s.width / 2 : s.left, top: s.top, width: s.width / 2, height: s.height }; };
  const coverHalf = side === 'back' ? 'left' : 'right';
  const insideHalf = side === 'back' ? 'right' : 'left';
  // the page area showing only the cover's half (corners rounded on the outside only)
  const onlyCoverHalf = () => {
    const w = Math.round(sr().width / 2);
    return side === 'back' ? `inset(0px ${w}px 0px 0px round ${radius}px 0px 0px ${radius}px)` : `inset(0px 0px 0px ${w}px round 0px ${radius}px ${radius}px 0px)`;
  };
  const fullClip = `inset(0px 0px 0px 0px round ${radius}px)`;
  // the page area cut to the cover's size and corners
  const toRect = (r) => {
    const s = sr();
    const corners = side === 'back' ? `${R3}px 2px 2px ${R3}px` : `2px ${R3}px ${R3}px 2px`;
    return `inset(${r.top - s.top}px ${s.right - (r.left + r.width)}px ${s.bottom - (r.top + r.height)}px ${r.left - s.left}px round ${corners})`;
  };

  // Two pages across, a closed book lies in the middle and an open one is
  // centered on its spine: the book slides over by half the cover's width as
  // it opens or closes, the moving cover with it. Where the open cover lies
  // (against the spine) and how far it is from the middle:
  const openRect = (size) => {
    const b = coverBox(stage, size, 2, side);
    const mid = Math.round(sr().width / 2);
    return screenRect({ ...b, left: side === 'back' ? mid - b.width : mid });
  };
  const slide = (from, to) => {
    const opts = { duration: hurry ? 1 : dur, easing: 'cubic-bezier(.45,0,.35,1)', fill: 'forwards' };
    const kf = [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }];
    stage.animate(kf, opts);
    return rig.animate(kf, opts).finished.catch(() => {});
  };
  // The crease between the pages belongs to an open book: none while only
  // one side shows, then it deepens as the other side comes down (or fades
  // as it lifts).
  const crease = (on) => {
    const sp = $('#spine');
    if (!sp) return;
    sp.animate(on ? [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }],
      { duration: hurry ? 1 : dur, easing: 'linear', fill: 'forwards' });
  };

  // from the cover to the pages next to it
  async function leave() {
    const face = coverFace();
    if (!face) return go();
    const fr = face.getBoundingClientRect();
    const src = face.querySelector('img').src;
    stage.style.opacity = '0';
    if (spread) {
      const size = { w: fr.width, h: fr.height };
      const or = openRect(size);
      const shift = fr.left - or.left; // closed (middle) from open (at the spine)
      rig.style.transform = `translateX(${shift}px)`;
      const front = coverLeaf(or, src, side);
      leaves.push(front);
      // (placed while the page area is where it rests, as it will be open)
      const inside = insideLeaf(half(insideHalf), side);
      leaves.push(inside);
      inside.style.transform = `perspective(2400px) rotateY(${90 * m}deg)`;
      await go();
      await settled();
      stage.style.transform = `translateX(${shift}px)`;
      stage.style.clipPath = onlyCoverHalf();
      stage.style.opacity = '';
      // (the page around a cover narrower than it shows as the cover lifts)
      stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: hurry ? 1 : dur * 0.3, easing: 'ease-out' });
      crease(true);
      const slid = slide(shift, 0);
      await quarter(front, 0, -90 * m, dur / 2, RISE);
      front.style.visibility = 'hidden';
      await quarter(inside, 90 * m, 0, dur / 2, LAND);
      await slid;
      // landed: the blank page takes over from it
      stage.style.clipPath = '';
      await inside.animate([{ opacity: 1 }, { opacity: 0 }], { duration: hurry ? 1 : 120, fill: 'forwards' }).finished.catch(() => {});
    } else {
      const front = coverLeaf(fr, src, side);
      leaves.push(front);
      await go();
      await settled();
      stage.style.clipPath = toRect(fr);
      stage.style.opacity = '';
      await quarter(front, 0, -90 * m, dur * 0.55, RISE);
      front.style.visibility = 'hidden';
      await stage.animate([{ clipPath: toRect(fr) }, { clipPath: fullClip }],
        { duration: hurry ? 1 : dur * 0.45, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).finished.catch(() => {});
    }
  }

  // from the pages to the cover
  async function arrive() {
    const src = side === 'back' ? R.backSrc : R.coverSrc;
    if (!src) {
      // the cover's picture isn't known: just let the pages go
      await stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: hurry ? 1 : dur * 0.4, fill: 'forwards' }).finished.catch(() => {});
      await go();
      for (let i = 0; i < 40 && !coverFace(); i++) await nextFrame();
      return;
    }
    const size = await measure(src);
    if (spread) {
      const or = openRect(size);
      const shift = screenRect(coverBox(stage, size, 2, side)).left - or.left;
      const front = coverLeaf(or, src, side);
      leaves.push(front);
      front.style.transform = `perspective(2400px) rotateY(${-90 * m}deg)`;
      // the blank page facing the text rises, then comes down as the cover,
      // and the book slides back to the middle
      const inside = insideLeaf(half(insideHalf), side);
      leaves.push(inside);
      stage.style.clipPath = onlyCoverHalf();
      crease(false);
      const slid = slide(0, shift);
      await quarter(inside, 0, 90 * m, dur / 2, RISE);
      inside.style.visibility = 'hidden';
      stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: hurry ? 1 : dur / 2, easing: 'ease-in', fill: 'forwards' });
      await quarter(front, -90 * m, 0, dur / 2, LAND);
      await slid;
    } else {
      const cr = screenRect(coverBox(stage, size, 1, side));
      const front = coverLeaf(cr, src, side);
      leaves.push(front);
      front.style.transform = `perspective(2400px) rotateY(${-90 * m}deg)`;
      // the page closes in to the size of the book, and the cover comes down on it
      await stage.animate([{ clipPath: fullClip }, { clipPath: toRect(cr) }],
        { duration: hurry ? 1 : dur * 0.45, easing: 'cubic-bezier(.6,0,.8,.4)', fill: 'forwards' }).finished.catch(() => {});
      await quarter(front, -90 * m, 0, dur * 0.55, LAND);
    }
    // the real cover goes in under the stand-in
    stage.getAnimations().forEach((x) => x.cancel());
    stage.style.opacity = '0';
    stage.style.transform = '';
    await go();
    for (let i = 0; i < 40 && !coverFace(); i++) await nextFrame();
  }

  motion = true;
  return animation(async () => {
    rv.classList.add('cover-turning');
    rig = document.createElement('div');
    rig.className = 'cover-rig';
    rv.append(rig);
    try { await (toCover ? arrive() : leave()); } finally {
      stage.getAnimations().forEach((x) => x.cancel());
      $('#spine')?.getAnimations().forEach((x) => x.cancel());
      Object.assign(stage.style, { opacity: '', clipPath: '', transform: '' });
      leaves.forEach((l) => l.remove());
      rig.remove();
      rig = null;
      rv.classList.remove('cover-turning');
    }
  }).finally(() => { motion = false; schedulePrepare(); });
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
  motion = true;
  const viewer = $('#viewer');
  const half = Math.max(140, ms * 0.7);
  const t = (x) => ({ transform: x });
  // Each animation keeps its own character in two halves: the old page
  // leaves, the book moves, the new page arrives.
  const plans = {
    fade: [[{ opacity: 1 }, { opacity: 0 }], [{ opacity: 0 }, { opacity: 1 }]],
    slide: [[{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-sign * 4}%)`, opacity: 0 }],
      [{ transform: `translateX(${sign * 4}%)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }]],
    push: [[t('translateX(0)'), t(`translateX(${-sign * 100}%)`)], [t(`translateX(${sign * 100}%)`), t('translateX(0)')]],
    cover: [[t('translateX(0)'), t(`translateX(${-sign * 102}%)`)], [{ opacity: 0 }, { opacity: 1 }]],
    zoom: [[{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.06)', opacity: 0 }], [{ transform: 'scale(.97)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }]],
    rise: [[{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-sign * 4}%)`, opacity: 0 }],
      [{ transform: `translateY(${sign * 4}%)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }]],
    // curl and flip: the page swings away about its edge and the next swings in
    flip: [[t('perspective(1600px) rotateY(0deg)'), t(`perspective(1600px) rotateY(${sign * 90}deg)`)],
      [t(`perspective(1600px) rotateY(${-sign * 90}deg)`), t('perspective(1600px) rotateY(0deg)')]],
  };
  const plan = plans[kind === 'curl' ? 'flip' : kind] || plans.slide;
  const swing = kind === 'curl' || kind === 'flip';
  viewer.style.transformOrigin = swing ? (sign > 0 ? 'left center' : 'right center') : '';
  const a = viewer.animate(plan[0], { duration: half, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
  await a.finished.catch(() => {});
  await go();
  await liveReady(here());
  a.cancel();
  if (swing) viewer.style.transformOrigin = sign > 0 ? 'right center' : 'left center';
  await viewer.animate(plan[1], { duration: half, easing: 'cubic-bezier(.25,.8,.25,1)' }).finished.catch(() => {});
  viewer.style.transformOrigin = '';
}

// What page turns are working from, for Settings and for reports.
export const pictureStatus = { capture: 'not tried', pager: 'not tried', webgl: null };
export function turnStatus() {
  let webgl = 'unavailable';
  try {
    const e = curlEngine();
    if (e.ok) {
      const ext = e.gl.getExtension('WEBGL_debug_renderer_info');
      webgl = ext ? e.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'available';
    }
  } catch { /* none */ }
  return { ...pictureStatus, webgl };
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
  const st = $('#stage').getBoundingClientRect(), ov = ($('#turn-over') || $('#stage')).getBoundingClientRect();
  const area = { W: Math.round(ov.width), H: Math.round(ov.height), x: Math.round(st.left - ov.left), y: Math.round(st.top - ov.top) };
  const base = { image: s.bitmap, W, H, area, cap: { x: 0, y: 0, w: W, h: H }, radius: R.pageRadius || 0, hingeRound: !spread, ...themeColors() };
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

// Which corner leads the curl (Settings → Pages): the fold line's tilt.
// 'auto' curls from the corner nearest where the page was clicked (the
// bottom one for keys and other turns).
let clickedAt = null;
function curlAngle() {
  let from = getSettings().curlFrom;
  if (from === 'auto') from = clickedAt == null ? 'bottom' : clickedAt < 0.36 ? 'top' : clickedAt > 0.64 ? 'bottom' : 'middle';
  return from === 'top' ? -0.26 : from === 'middle' ? 0 : 0.26;
}

// Shadows grow in as the page lifts and fade away as it lands, so nothing
// is left to vanish at once when the turn ends. x: progress, 0..1.
const shadowFor = (x) => smooth(0, 0.08, x) * (1 - smooth(0.68, 1, x));

async function leafTurn(kind, sign, ms, go, s, ctx) {
  const e = curlEngine();
  const rigid = kind === 'flip';
  const angle = rigid ? 0 : curlAngle();
  // first frame: just the old page, then the book moves underneath it
  showSnap(s);
  await nextFrame();
  await go();
  const n = arrivingNow(ctx);
  const setup = leafSetup(s, sign, n);
  if (!e.begin(setup)) { ctx.done = true; await liveReady(n?.cfi); hideSnap(); return; }
  let t = 0;
  const at = (x) => (setup.reverse ? 1 - x : x);
  const frame = (tt, x = setup.reverse ? 1 - tt : tt) => {
    t = tt;
    const a = backAlpha(setup, tt);
    fadeStill(setup, a);
    e.draw(tt, angle, { backAlpha: a, rigid, shadow: shadowFor(x) });
  };
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
  motion = true; // (only now: waiting for pictures, nothing has moved yet)
  await run(duration, (x) => { const k = ease(x); frame(at(k), k); }, true);
  ctx.done = true;
  motion = false;
  await finish(e, { exact: !!setup.under || !!setup.back, cfi: here() });
}

// Once the book itself is ready underneath, the pictures go. If they were
// exact pictures of that page, they just go; otherwise they fade quickly.
async function finish(e, { leaf = !!e, exact = false, cfi = null } = {}) {
  await liveReady(cfi);
  // a landed leaf covers the old page it lies on
  if (leaf) hideSnap();
  const els = [e?.canvas, e?.shadowCanvas, snapEl, underEl].filter((x) => x && !x.hidden);
  if (!exact && !hurry) await Promise.all(els.map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: 'linear', fill: 'forwards' }).finished.catch(() => {})));
  e?.end();
  hideSnap();
  hideUnder();
  els.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
}

// Adaptive quality: if frames come slowly, the next turns draw the moving
// page at a lower resolution (it is in motion, so this is hard to see).
const QUALITY = [1, 0.9, 0.8, 0.7];
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
export async function startDrag({ sign, dir = sign, x: startX, y: startY, go, undo }) {
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
  // The page follows the pointer: it is held at the point of its free edge
  // where it was grabbed, and folds along whatever line brings that point
  // under the pointer — so moving up or down tilts the fold, like paper.
  const stage = $('#stage').getBoundingClientRect();
  const w = setup.leaf.w, h = setup.leaf.h;
  const toLeaf = (px, py) => [(px - stage.left - setup.hinge) * setup.side, py - stage.top - setup.leaf.top];
  const [x0, y0] = toLeaf(startX ?? stage.left + setup.hinge + setup.side * w, startY ?? stage.top + h / 2);
  const G = [w, Math.min(h, Math.max(0, y0))];
  // going back on a single page, the previous page comes in from the left:
  // the pointer holds its fold, so its corner travels twice as far
  const pointAt = (lx, ly) => e.constrain(G, setup.reverse ? [-w + 2 * (lx - x0), ly] : [w + (lx - x0), ly]);
  let P = setup.reverse ? [-w, G[1]] : [G[0], G[1]];
  let turned = setup.reverse ? 1 : 0; // how far over the page is, 0..1
  const draw = () => {
    const f = e.foldFor(G, P);
    turned = f.q;
    const progress = setup.reverse ? 1 - turned : turned;
    const a = backAlpha(setup, turned);
    fadeStill(setup, a);
    e.draw(turned, 0, { backAlpha: a, shadow: shadowFor(progress), fold: f });
  };
  const progressNow = () => (setup.reverse ? 1 - turned : turned);
  if (setup.under) showUnder(setup.under);
  if (setup.still) showSnap(s, clipFor(setup.still, s.W)); else hideSnap();
  draw();
  e.show(true);
  whenArrives(ctx, (p) => {
    if (setup.reverse) return;
    setup.under = p;
    showUnder(p);
    if (setup.landsOnPage && turned < 0.2) { setup.back = p.bitmap; e.setBack(p.bitmap); }
  });
  let last = { x: 0, time: performance.now() }, vel = 0;
  let pending = null, p0 = null;
  const flushMove = () => {
    if (!pending) return;
    const [px, py] = pending;
    pending = null;
    P = pointAt(...toLeaf(px, py));
    draw();
    if (p0 == null) p0 = progressNow();
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
      const q = progressNow();
      const moved = q - (p0 ?? 0);
      // In a spread the page has to be brought over the spine; a single
      // page is turned once its corner is past the middle of the page.
      const enough = setup.landsOnPage ? 0.5 : 0.3;
      const finishTurn = q > enough || moved > enough * 0.55 || (vel > 0.35 && moved > 0.03);
      // the held point glides to where the page comes to rest
      const over = [-w, G[1]], flat = [G[0], G[1]];
      const target = finishTurn === !setup.reverse ? over : flat;
      const from = P.slice();
      const left = Math.hypot(target[0] - from[0], target[1] - from[1]) / (2 * w);
      const duration = Math.max(180, left * 700);
      await run(duration, (x) => {
        const k = releaseEase(x);
        P = [from[0] + (target[0] - from[0]) * k, from[1] + (target[1] - from[1]) * k];
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
  motion = true;
  const watch = setInterval(() => { if (hurry) anims.forEach((a) => a.finish()); }, 16);
  await Promise.all(anims.map((a) => a.finished.catch(() => {})));
  clearInterval(watch);
  ctx.done = true;
  motion = false;
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

// For tests: hold a page curl still at a point of the turn, from the
// current page's own picture (forward, as a click would turn it).
export async function debugCurlFrame(t, angle = 0.26) {
  const s = await currentPicture();
  const e = curlEngine();
  const n = knownNeighbour(here(), 'next');
  const setup = leafSetup(s, 1, n);
  if (!e.begin(setup)) return 'no engine';
  if (setup.under) showUnder(setup.under);
  if (setup.still) showSnap(s, clipFor(setup.still, s.W)); else hideSnap();
  e.draw(t, angle, { backAlpha: backAlpha(setup, t), shadow: shadowFor(t) });
  e.show(true);
  return 'ok';
}

// For tests: the page held at G and pulled to P (leaf coordinates).
export async function debugCurlPull(G, P) {
  const s = await currentPicture();
  const e = curlEngine();
  const setup = leafSetup(s, 1, knownNeighbour(here(), 'next'));
  if (!e.begin(setup)) return 'no engine';
  if (setup.under) showUnder(setup.under);
  if (setup.still) showSnap(s, clipFor(setup.still, s.W)); else hideSnap();
  const f = e.foldFor(G, e.constrain(G, P));
  e.draw(f.q, 0, { backAlpha: backAlpha(setup, f.q), shadow: shadowFor(f.q), fold: f });
  e.show(true);
  return JSON.stringify({ w: setup.leaf.w, h: setup.leaf.h, f });
}
