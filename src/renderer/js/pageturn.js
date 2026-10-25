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
    blur: [
      [{ filter: 'blur(0)', opacity: 1 }, { filter: 'blur(6px)', opacity: 0.2 }],
      [{ filter: 'blur(6px)', opacity: 0.2 }, { filter: 'blur(0)', opacity: 1 }],
    ],
  }[kind];
  if (!frames) return go();
  await viewer.animate(frames[0], { duration: half, easing: easeIn, fill: 'forwards' }).finished;
  await go();
  await nextPaint();
  const a = viewer.animate(frames[1], { duration: half, easing: easeOut, fill: 'forwards' });
  await a.finished;
  a.cancel();
  viewer.getAnimations().forEach((x) => x.cancel());
}

// Realistic turns: photograph the current page, put the photo on top, turn
// the real page underneath, then animate the photo away.
async function snapshotTurn(kind, sign, ms, go) {
  const stage = $('#stage');
  const r = stage.getBoundingClientRect();
  let url;
  try { url = await window.api.window.capture({ x: r.left, y: r.top, width: r.width, height: r.height }); } catch { url = null; }
  if (!url) return go();
  const overlay = document.createElement('div');
  overlay.className = `turn-overlay turn-${kind}`;
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => {});
  overlay.append(img);
  const shade = document.createElement('div');
  shade.className = 'turn-shade';
  overlay.append(shade);
  stage.append(overlay);
  await go();
  await nextPaint();
  await sleep(16);
  const duration = Math.max(ms * 1.6, 260);
  const forward = sign > 0;
  let anim;
  if (kind === 'flip') {
    overlay.style.transformOrigin = forward ? 'left center' : 'right center';
    anim = overlay.animate([
      { transform: 'perspective(2200px) rotateY(0deg)' },
      { transform: `perspective(2200px) rotateY(${forward ? -100 : 100}deg)` },
    ], { duration, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'forwards' });
    shade.animate([{ opacity: 0 }, { opacity: 0.55 }], { duration, fill: 'forwards' });
  } else if (kind === 'cover') {
    anim = overlay.animate([
      { transform: 'translateX(0)', boxShadow: '0 0 0 rgba(0,0,0,0)' },
      { transform: `translateX(${forward ? -105 : 105}%)`, boxShadow: '0 0 40px rgba(0,0,0,.35)' },
    ], { duration, easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'forwards' });
  } else {
    // peel: the corner lifts and the page curls off toward the spine
    overlay.style.transformOrigin = forward ? 'left bottom' : 'right bottom';
    const sx = forward ? -1 : 1;
    anim = overlay.animate([
      { transform: 'perspective(1800px) rotateY(0) rotateZ(0) skewY(0)', clipPath: 'inset(0 0 0 0)' },
      { transform: `perspective(1800px) rotateY(${sx * 35}deg) rotateZ(${sx * 3}deg) skewY(${sx * 4}deg)`, clipPath: 'inset(0 0 0 0)', offset: 0.45 },
      { transform: `perspective(1800px) rotateY(${sx * 95}deg) rotateZ(${sx * 6}deg) skewY(${sx * 6}deg)`, clipPath: 'inset(0 0 0 0)' },
    ], { duration: duration * 1.1, easing: 'ease-in', fill: 'forwards' });
    shade.animate([{ opacity: 0 }, { opacity: 0.25, offset: 0.4 }, { opacity: 0.6 }], { duration: duration * 1.1, fill: 'forwards' });
  }
  await anim.finished.catch(() => {});
  overlay.remove();
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
  { id: 'blur', name: 'Blur' },
  { id: 'flip', name: 'Book flip (3D)' },
  { id: 'peel', name: 'Page peel' },
  { id: 'cover', name: 'Cover' },
];
