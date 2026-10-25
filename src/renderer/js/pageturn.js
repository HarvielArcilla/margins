// Every way to turn a page: keys, click/tap zones, mouse wheel, trackpad
// swipes, touch, game controllers and page-turner remotes, auto-turn and
// auto-scroll — plus the page-turn animations.
import { $ } from './ui.js';
import { getSettings, setSettings } from './settings.js';
import { R, next as rNext, prev as rPrev, toggleChrome, showChrome } from './reader.js';
import * as stats from './stats.js';
import * as focus from './focus.js';
import * as tts from './tts.js';

let busy = false;
let queued = 0;

// dir: +1 forward in reading order, -1 back.
export async function turn(dir, { source = 'user' } = {}) {
  if (!R.rendition) return;
  if (source === 'user') { stats.activity(); resetAutoTurn(); if (getSettings().autoPauseOnInteract && autoScroll.on) stopAuto(); }
  if (busy) { queued = Math.max(-2, Math.min(2, queued + dir)); return; }
  busy = true;
  try {
    const s = getSettings();
    const go = () => (dir > 0 ? rNext() : rPrev());
    if (s.flow !== 'paginated' || s.pageAnimation === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await go();
    } else {
      await animate(s.pageAnimation, dir, s.animationMs, go);
    }
    if (!$('#reader-view').classList.contains('show-chrome')) showChrome(false);
    focus.pageTurned();
    if (source === 'user' && tts.speaking()) tts.restart();
  } finally {
    busy = false;
  }
  if (queued) { const q = Math.sign(queued); queued -= q; turn(q, { source: 'queue' }); }
}

// Visual direction: in right-to-left books the next page is on the left.
const visual = (dirRight) => (R.rtl ? -dirRight : dirRight);

// ---------- animations ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function animate(kind, dir, ms, go) {
  const viewer = $('#viewer');
  const sign = R.rtl ? -dir : dir;
  const half = Math.max(60, ms / 2);
  const easeOut = 'cubic-bezier(.2,.7,.2,1)';
  const easeIn = 'cubic-bezier(.5,0,.75,0)';

  if (['flip', 'cover', 'peel'].includes(kind)) return snapshotTurn(kind, sign, ms, go);

  const frames = {
    fade: [[{ opacity: 1 }, { opacity: 0 }], [{ opacity: 0 }, { opacity: 1 }]],
    slide: [
      [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-sign * 5}%)`, opacity: 0 }],
      [{ transform: `translateX(${sign * 5}%)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }],
    ],
    push: [
      [{ transform: 'translateX(0)' }, { transform: `translateX(${-sign * 100}%)` }],
      [{ transform: `translateX(${sign * 100}%)` }, { transform: 'translateX(0)' }],
    ],
    zoom: [
      [{ transform: 'scale(1)', opacity: 1 }, { transform: `scale(${dir > 0 ? 0.94 : 1.04})`, opacity: 0 }],
      [{ transform: `scale(${dir > 0 ? 1.04 : 0.94})`, opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
    ],
    rise: [
      [{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-sign * 3}%)`, opacity: 0 }],
      [{ transform: `translateY(${sign * 3}%)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
    ],
  }[kind] || null;
  if (!frames) return animate('slide', dir, ms, go);
  viewer.style.willChange = 'transform, opacity';
  await viewer.animate(frames[0], { duration: half, easing: easeIn, fill: 'forwards' }).finished;
  await go();
  await nextPaint();
  const a = viewer.animate(frames[1], { duration: half, easing: easeOut, fill: 'forwards' });
  await a.finished;
  a.cancel();
  viewer.getAnimations().forEach((x) => x.cancel());
  viewer.style.willChange = '';
}

// Realistic turns photograph the current spread, lay the photo over the
// stage, move the real book to its new page underneath, then animate pieces
// of the photo away. In a two-page spread only one leaf turns: going forward
// the right-hand page lifts off the spine, revealing the new right page, and
// lands on the left, uncovering the new left page as it comes down. Going
// back, the left-hand page does the same in the other direction. With a
// single page, the page turns away from its left edge (forward) or the
// previous page settles down from the left (back).
async function snapshotTurn(kind, sign, ms, go) {
  const stage = $('#stage');
  const r = stage.getBoundingClientRect();
  const W = r.width, H = r.height;
  let url = null;
  const t0 = performance.now();
  try { url = await window.api.window.capture({ x: r.left, y: r.top, width: W, height: H }); } catch { url = null; }
  // If grabbing the frame is slow (some GPU drivers) fall back to a slide
  // rather than leave the reader waiting.
  if (!url || performance.now() - t0 > 250) return animate('slide', sign * (R.rtl ? -1 : 1), ms, go);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { return go(); }
  if (!img.naturalWidth) return go();

  const L = R.layout || { cols: 1, padX: 0, width: W };
  const spread = L.cols === 2;
  const forward = sign > 0;
  const bg = `url(${url})`;

  const root = div('turn-overlay');
  const part = (x0, x1) => {
    const d = div('turn-part');
    Object.assign(d.style, { left: `${x0}px`, width: `${x1 - x0}px`, backgroundImage: bg, backgroundSize: `${W}px ${H}px`, backgroundPosition: `${-x0}px 0` });
    return d;
  };

  if (kind === 'cover') {
    const sheet = part(0, W);
    sheet.classList.add('turn-sheet');
    root.append(sheet);
    stage.append(root);
    await go();
    await nextPaint();
    await sheet.animate([
      { transform: 'translateX(0)' },
      { transform: `translateX(${forward ? -102 : 102}%)` },
    ], { duration: Math.max(ms * 1.4, 240), easing: 'cubic-bezier(.3,.6,.25,1)', fill: 'forwards' }).finished.catch(() => {});
    root.remove();
    return;
  }

  // Geometry: the hinge is the spine in a spread, the page's left edge otherwise.
  // The page itself spans the book area; the window margins stay put.
  const x0 = Math.max(0, Math.round(L.padX || 0));
  const x1 = Math.min(W, Math.round((L.padX || 0) + (L.width || W)));
  const spine = spread ? Math.round((x0 + x1) / 2) : x0;
  let leaf = null, still = null, landDir;
  if (spread) {
    if (forward) { leaf = part(spine, x1); still = part(x0, spine); landDir = -1; } else { leaf = part(x0, spine); still = part(spine, x1); landDir = 1; }
  } else if (forward) {
    leaf = part(x0, x1); landDir = 0;
  } else {
    still = part(x0, x1); landDir = 1; // previous page settles down from the left
  }
  const cast = div('turn-cast');
  const edge = div('turn-edge');
  if (still) root.append(still);
  root.append(cast);
  if (leaf) {
    leaf.style.transformOrigin = forward ? 'left center' : 'right center';
    const shade = div('turn-leaf-shade');
    leaf.append(shade);
    root.append(leaf);
  }
  root.append(edge);
  stage.append(root);
  await go();
  await nextPaint();

  const peel = kind === 'peel';
  const duration = Math.max(ms * (peel ? 2 : 1.8), 300);
  const stillW = still ? parseFloat(still.style.width) : 0;
  const stillX = still ? parseFloat(still.style.left) : 0;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  await new Promise((resolve) => {
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = ease(t);
      // Without a leaf (single page, going back) the whole move is a landing.
      // single page forward: just the lift; spread: lift then land; back: land
      const theta = leaf ? (still ? e * 180 : e * 90) : 90 + e * 90;
      if (leaf) {
        if (theta <= 90) {
          const a = forward ? -theta : theta;
          const lift = Math.sin((theta * Math.PI) / 180);
          const curl = peel ? `rotateZ(${(forward ? -1 : 1) * lift * 4}deg) skewY(${(forward ? -1 : 1) * lift * 5}deg)` : '';
          leaf.style.transform = `perspective(${Math.max(W, 1400) * 1.6}px) rotateY(${a}deg) ${curl}`;
          leaf.firstChild.style.opacity = String(lift * 0.55);
          leaf.style.visibility = 'visible';
          // shadow the lifting page casts on the page it uncovers
          const lx = parseFloat(leaf.style.left), lw = parseFloat(leaf.style.width);
          Object.assign(cast.style, { left: `${lx}px`, width: `${lw}px`, opacity: String(0.5 * (1 - lift) * lift * 2) });
          cast.dataset.side = forward ? 'left' : 'right';
        } else {
          leaf.style.visibility = 'hidden';
          cast.style.opacity = '0';
        }
      }
      // Landing: uncover the new page from the hinge outward, with the edge
      // of the falling page drawn as a soft shadow line.
      if (theta > 90 && still && landDir) {
        const p = -Math.cos((theta * Math.PI) / 180); // projected width of the falling page, 0 → 1
        const covered = stillW * p;
        if (landDir < 0) { // landing on the left: reveal from the spine leftward
          still.style.clipPath = `inset(0 ${covered}px 0 0)`;
          placeEdge(stillX + stillW - covered, -1, p);
        } else { // landing on the right (or single page from the left edge)
          still.style.clipPath = `inset(0 0 0 ${covered}px)`;
          placeEdge(stillX + covered, 1, p);
        }
      } else if (theta > 90 && !still) {
        edge.style.opacity = '0';
      }
      if (t < 1) requestAnimationFrame(frame); else resolve();
    };
    function placeEdge(x, dir, p) {
      edge.dataset.dir = dir < 0 ? 'left' : 'right';
      Object.assign(edge.style, { left: `${x - (dir < 0 ? 0 : 36)}px`, opacity: String(Math.min(1, (1 - p) * 3) * 0.9) });
    }
    requestAnimationFrame(frame);
  });
  root.remove();
}

function div(cls) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

// ---------- keyboard ----------
export function handleKey(e) {
  if (!R.open || e.defaultPrevented) return false;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const s = getSettings();
  const k = e.key;
  let dir = 0;
  if (s.keyArrows && (k === 'ArrowRight' || k === 'ArrowLeft')) dir = visual(k === 'ArrowRight' ? 1 : -1);
  else if (s.keyArrows && (k === 'ArrowDown' || k === 'ArrowUp')) {
    if (focus.rulerActive()) { focus.moveRuler(k === 'ArrowDown' ? 1 : -1); e.preventDefault(); return true; }
    if (s.flow === 'paginated') dir = k === 'ArrowDown' ? 1 : -1;
  } else if (s.keySpace && k === ' ') dir = e.shiftKey ? -1 : 1;
  else if (s.keyPage && (k === 'PageDown' || k === 'PageUp')) dir = k === 'PageDown' ? 1 : -1;
  else if (s.keyVim && (k === 'j' || k === 'l')) dir = 1;
  else if (s.keyVim && (k === 'k' || k === 'h')) dir = -1;
  else if (s.keyWasd && (k === 'd' || k === 's')) dir = 1;
  else if (s.keyWasd && (k === 'a' || k === 'w')) dir = -1;
  else if (s.keyMedia && (k === 'MediaTrackNext' || k === 'AudioVolumeDown')) dir = 1;
  else if (s.keyMedia && (k === 'MediaTrackPrevious' || k === 'AudioVolumeUp')) dir = -1;
  else if (k === 'Enter' && s.flow === 'paginated') dir = 1;
  if (!dir) return false;
  e.preventDefault();
  turn(dir);
  return true;
}

// ---------- click / tap zones ----------
export function handleClick({ x, y }) {
  const s = getSettings();
  const r = $('#stage').getBoundingClientRect();
  const rx = (x - r.left) / r.width, ry = (y - r.top) / r.height;
  if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return;
  let action = zoneAction(s.clickZones, rx, ry);
  if (s.invertZones && (action === 'next' || action === 'prev')) action = action === 'next' ? 'prev' : 'next';
  stats.activity();
  if (action === 'menu') { toggleChrome(); return; }
  if (!action) return;
  // Zones are visual (left/right); map to reading direction.
  const dirRight = action === 'next' ? 1 : -1;
  const isVertical = s.clickZones === 'top-bottom';
  turn(isVertical ? dirRight : visual(dirRight));
}

export function zoneAction(layout, rx, ry) {
  switch (layout) {
    case 'thirds': return rx < 0.3 ? 'prev' : rx > 0.7 ? 'next' : 'menu';
    case 'halves': return ry < 0.12 ? 'menu' : rx < 0.5 ? 'prev' : 'next';
    case 'left-third': return ry < 0.12 ? 'menu' : rx < 0.25 ? 'prev' : 'next';
    case 'all-next': return ry < 0.15 ? 'menu' : 'next';
    case 'top-bottom': return rx > 0.35 && rx < 0.65 && ry > 0.4 && ry < 0.6 ? 'menu' : ry < 0.5 ? 'prev' : 'next';
    case 'kindle': return ry < 0.12 ? 'menu' : rx < 0.2 ? 'prev' : 'next';
    case 'off': return 'menu';
    default: return 'menu';
  }
}

export const ZONE_LAYOUTS = [
  { id: 'thirds', name: 'Thirds — left back, right forward, middle menu' },
  { id: 'kindle', name: 'Kindle-style — narrow left strip back, rest forward' },
  { id: 'halves', name: 'Halves — left back, right forward' },
  { id: 'left-third', name: 'One-handed — left quarter back, rest forward' },
  { id: 'all-next', name: 'Tap anywhere to go forward' },
  { id: 'top-bottom', name: 'Top back, bottom forward' },
  { id: 'off', name: 'Off — clicks only show the menu' },
];

// ---------- wheel & trackpad ----------
let wheelAcc = 0, wheelAccX = 0, wheelLock = 0;
export function handleWheel(e) {
  const s = getSettings();
  if (!R.open || s.flow !== 'paginated') return;
  if (e.ctrlKey) return; // pinch zoom
  e.preventDefault?.();
  const now = Date.now();
  if (now < wheelLock) return;
  wheelAccX += e.deltaX;
  if (s.wheelTurns) wheelAcc += e.deltaY * (s.wheelInvert ? -1 : 1);
  const threshold = e.deltaMode === 1 ? 2 : 60;
  if (s.swipeTurns && Math.abs(wheelAccX) > threshold * 1.4) {
    const d = Math.sign(wheelAccX);
    reset(); turn(visual(d)); return;
  }
  if (Math.abs(wheelAcc) > threshold) {
    const d = Math.sign(wheelAcc);
    reset(); turn(d);
  }
  function reset() { wheelAcc = 0; wheelAccX = 0; wheelLock = now + 380; }
}

export function handleSwipe(dx, dy, dt) {
  const s = getSettings();
  if (!s.swipeTurns || dt > 800) return;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(visual(dx < 0 ? 1 : -1));
}

// ---------- game controllers & page-turner remotes ----------
let padRaf = null;
const padPrev = new Map();
function pollPads() {
  padRaf = null;
  if (!getSettings().gamepad) return;
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  for (const p of pads) {
    const was = padPrev.get(p.index) || [];
    const now = p.buttons.map((b) => b.pressed);
    const pressed = (i) => now[i] && !was[i];
    // Standard mapping: 0 A, 1 B, 4 LB, 5 RB, 6 LT, 7 RT, 12 up, 13 down, 14 left, 15 right
    if (R.open) {
      if (pressed(0) || pressed(5) || pressed(7) || pressed(15) || pressed(13)) turn(1);
      if (pressed(1) || pressed(4) || pressed(6) || pressed(14) || pressed(12)) turn(-1);
      if (pressed(9)) toggleChrome();
    }
    const ax = p.axes[0] || 0;
    const wasAx = padPrev.get(`ax${p.index}`) || 0;
    if (R.open && Math.abs(ax) > 0.7 && Math.abs(wasAx) <= 0.7) turn(visual(ax > 0 ? 1 : -1));
    padPrev.set(`ax${p.index}`, ax);
    padPrev.set(p.index, now);
  }
  if (pads.length) padRaf = requestAnimationFrame(pollPads);
}
window.addEventListener('gamepadconnected', () => { if (!padRaf) padRaf = requestAnimationFrame(pollPads); });

// ---------- auto-turn & auto-scroll ----------
const autoTurn = { on: false, timer: null, started: 0 };
const autoScroll = { on: false, raf: null, last: 0, carry: 0 };

export function autoRunning() { return autoTurn.on || autoScroll.on; }

export function toggleAuto() {
  if (autoRunning()) { stopAuto(); return false; }
  const s = getSettings();
  if (s.flow === 'paginated') startAutoTurn(); else startAutoScroll();
  return true;
}

function startAutoTurn() {
  autoTurn.on = true;
  autoTurn.started = Date.now();
  $('#reader-view').classList.add('auto-on');
  const tick = () => {
    if (!autoTurn.on) return;
    const secs = getSettings().autoTurnSeconds;
    const p = (Date.now() - autoTurn.started) / (secs * 1000);
    $('#auto-bar').style.transform = `scaleX(${Math.min(1, p)})`;
    if (p >= 1) { autoTurn.started = Date.now(); turn(1, { source: 'auto' }); }
    autoTurn.timer = setTimeout(tick, 100);
  };
  tick();
  updateAutoButton();
}

function resetAutoTurn() { if (autoTurn.on) autoTurn.started = Date.now(); }

function startAutoScroll() {
  autoScroll.on = true;
  autoScroll.last = performance.now();
  $('#reader-view').classList.add('auto-on');
  const step = (t) => {
    if (!autoScroll.on) return;
    const dt = t - autoScroll.last;
    autoScroll.last = t;
    const box = R.rendition?.manager?.container;
    if (box) {
      autoScroll.carry += (getSettings().autoScrollSpeed * dt) / 1000;
      const px = Math.floor(autoScroll.carry);
      autoScroll.carry -= px;
      if (px) box.scrollTop += px;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2 && getSettings().flow === 'scrolled') {
        rNext();
      }
      stats.activity({ passive: true });
    }
    autoScroll.raf = requestAnimationFrame(step);
  };
  autoScroll.raf = requestAnimationFrame(step);
  updateAutoButton();
}

export function stopAuto() {
  autoTurn.on = false;
  clearTimeout(autoTurn.timer);
  autoScroll.on = false;
  cancelAnimationFrame(autoScroll.raf);
  $('#reader-view')?.classList.remove('auto-on');
  const bar = $('#auto-bar');
  if (bar) bar.style.transform = 'scaleX(0)';
  updateAutoButton();
}

function updateAutoButton() {
  const b = $('#auto-btn');
  if (b) b.classList.toggle('active', autoRunning());
}

export function nudgeAutoSpeed(delta) {
  const s = getSettings();
  if (s.flow === 'paginated') setSettings({ autoTurnSeconds: Math.max(3, Math.min(300, s.autoTurnSeconds - delta * 2)) });
  else setSettings({ autoScrollSpeed: Math.max(5, Math.min(400, s.autoScrollSpeed + delta * 5)) });
}

export const ANIMATIONS = [
  { id: 'none', name: 'None (instant)' },
  { id: 'slide', name: 'Slide' },
  { id: 'push', name: 'Push' },
  { id: 'fade', name: 'Fade' },
  { id: 'zoom', name: 'Zoom' },
  { id: 'rise', name: 'Rise' },
  { id: 'flip', name: 'Book flip (3D)' },
  { id: 'peel', name: 'Page curl' },
  { id: 'cover', name: 'Cover' },
];
