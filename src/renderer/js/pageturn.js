// Every way to turn a page: keys, click/tap zones, mouse wheel, trackpad
// swipes, touch, game controllers and page-turner remotes, auto-turn and
// auto-scroll — plus the page-turn animations.
import { $ } from './ui.js';
import { getSettings, setSettings } from './settings.js';
import { R, next as rNext, prev as rPrev, toggleChrome, showChrome, liveContents, onContents, coverTurnAt, coverGo, pastCover } from './reader.js';
import * as stats from './stats.js';
import * as focus from './focus.js';
import * as tts from './tts.js';
import { animate, coverTurn, hurryUp, inMotion, chainNext, nextWaiting, startDrag, ANIMATIONS } from './turn-anim.js';

export { ANIMATIONS };

let busy = false;
// turns asked for while one is busy: { dir, instant }
const queued = [];
let dragging = false;

// dir: +1 forward in reading order, -1 back.
// Every click or press is one page. Only the motion adapts, smoothly, by how
// far the page on screen has moved when the next turn is asked for:
// - the page on screen finishes, and the next turn goes, at one and the
//   same speed, so the page keeps one pace: quick if asked for early on,
//   nearer the ordinary pace the later (rising steeply, then levelling
//   off); the next starts the moment the first lands; asked for once
//   nothing moves, it's an ordinary turn;
// - a fourth one while turns are still stacked up means flipping: the turn
//   on screen ends at once and turns go instantly, until there's a short
//   pause; then they animate again.
// Holding a key down (the key repeating) is flipping from the first repeat.
const FLIP_PAUSE = 350;    // ms without a turn asked for that ends flipping
let flipping = false;
let flipTimer = 0;
function stillFlipping() {
  clearTimeout(flipTimer);
  flipTimer = setTimeout(() => { flipping = false; }, FLIP_PAUSE);
}
export async function turn(dir, { source = 'user', at = null, repeat = false, pace = 1 } = {}) {
  if (!R.rendition) return;
  if (source === 'user') { stats.activity(); resetAutoTurn(); if (getSettings().autoPauseOnInteract && autoScroll.on) stopAuto(); }
  if (dragging) return;
  if (pastCover(dir)) return;
  const s = getSettings();
  const asked = source === 'user';
  if (asked && flipping) stillFlipping();
  if (busy) {
    if (repeat || flipping || queued.length >= 2) {
      // flipping: no more animations until a pause
      flipping = true;
      stillFlipping();
      hurryUp();
      queued.forEach((q) => { q.instant = true; });
      if (queued.length < 12) queued.push({ dir, instant: true });
      return;
    }
    // the page on screen finishes, and the next turn goes, at one speed set
    // by how far it has got (see chainNext); the next starts the moment this
    // one lands; once nothing moves, it's an ordinary turn
    const pace = inMotion() ? chainNext() : 1;
    queued.push({ dir, instant: false, pace });
    nextWaiting(true);
    return;
  }
  if (repeat && asked) { flipping = true; stillFlipping(); }
  // queued while flipping, a held key, or flipping still: no animation
  const rapid = source === 'queue' || repeat || (asked && flipping);

  const ms = s.animationMs;
  busy = true;
  R.turning = true;
  try {
    const go = () => (dir > 0 ? rNext() : rPrev());
    const tc = coverTurnAt(dir);
    if (rapid || s.flow !== 'paginated' || s.pageAnimation === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await (tc ? coverGo(tc) : go());
    } else if (tc) {
      await coverTurn(tc, ms, () => coverGo(tc), { pace });
    } else {
      await animate(s.pageAnimation, visual(dir), ms, go, dir, at, { pace, chained: source === 'queued' });
    }
    if (!$('#reader-view').classList.contains('show-chrome')) showChrome(false);
    focus.pageTurned();
    if (source === 'user' && tts.speaking()) tts.restart();
  } finally {
    busy = false;
    R.turning = false;
    R.turnedAt = performance.now();
    nextWaiting(false);
  }
  const q = queued.shift();
  if (q) turn(q.dir, { source: q.instant ? 'queue' : 'queued', pace: q.pace ?? 1 });
}

// Visual direction: in right-to-left books the next page is on the left.
const visual = (dirRight) => (R.rtl ? -dirRight : dirRight);

// ---------- dragging a page (page curl) ----------
// Press in the margin beside the text and drag toward the spine to lift the
// page; it follows the pointer and finishes (or falls back) when released.
let swallowClick = false;
export function consumeClick() { if (swallowClick) { swallowClick = false; return true; } return false; }

export function handlePointerDown(pt, ev, doc) {
  const s = getSettings();
  if (ev.button !== 0 || s.flow !== 'paginated' || s.pageAnimation !== 'curl' || busy || !R.layout) return;
  if (document.body.classList.contains('sidebar-open') || document.body.classList.contains('settings-open')) return;
  const L = R.layout;
  const stage = $('#stage').getBoundingClientRect();
  if (pt.y < stage.top || pt.y > stage.bottom) return;
  const textLeft = stage.left + L.padX + L.inset;
  const textRight = stage.left + L.padX + L.width - L.inset;
  let side = 0; // visual: +1 grabbed on the right (page moves left)
  if (pt.x >= textRight - 2) side = 1;
  else if (pt.x <= textLeft + 2) side = -1;
  if (!side) return;
  ev.preventDefault(); // no text selection from the margin
  const dir = R.rtl ? -side : side;
  // covers open and close with a click or key, not a drag; nothing lies past them
  if (coverTurnAt(dir) || pastCover(dir) || $('#stage').classList.contains('closed')) return;
  const toTop = (e) => {
    const f = e.view && e.view !== window ? e.view.frameElement?.getBoundingClientRect() : null;
    return f ? { x: f.left + e.clientX, y: f.top + e.clientY } : { x: e.clientX, y: e.clientY };
  };
  let ctrl = null, starting = false, latest = pt, released = false;
  // The pointer can be over the top document or any page frame while it
  // drags, and turning to another chapter replaces the page frames mid-drag.
  // A transparent shield over everything keeps the pointer in the top
  // document; frames that appear during the drag are listened to as well.
  const shield = document.createElement('div');
  shield.className = 'drag-shield';
  const targets = new Set([window, doc.defaultView || window, ...liveContents().map((c) => c.window).filter(Boolean)]);
  const listen = (t) => { t.addEventListener('mousemove', onMove, true); t.addEventListener('mouseup', onUp, true); };
  activeDrag = (w) => { if (w && !targets.has(w)) { targets.add(w); listen(w); } };
  const onMove = (e) => {
    latest = toTop(e);
    if (ctrl) { ctrl.move(latest.x, latest.y); return; }
    if (starting) return;
    if ((pt.x - latest.x) * side > 6) {
      starting = true;
      dragging = true;
      R.turning = true;
      document.body.append(shield); // only once it is really a drag, so clicks still reach the page
      busy = true;
      stats.activity();
      startDrag({ sign: side, dir, x: pt.x, y: pt.y, go: () => (dir > 0 ? rNext() : rPrev()), undo: () => (dir > 0 ? rPrev() : rNext()) })
        .then((c) => {
          if (!c) { dragging = false; busy = false; R.turning = false; return; }
          ctrl = c;
          ctrl.move(latest.x, latest.y);
          if (released) finish();
        });
    }
  };
  const finish = async () => {
    const turned = await ctrl.release();
    dragging = false;
    R.turning = false;
    R.turnedAt = performance.now();
    busy = false;
    if (turned) { focus.pageTurned(); if (tts.speaking()) tts.restart(); }
  };
  const onUp = (e) => {
    for (const t of targets) { t.removeEventListener('mousemove', onMove, true); t.removeEventListener('mouseup', onUp, true); }
    shield.remove();
    activeDrag = null;
    released = true;
    if (starting) { swallowClick = true; setTimeout(() => { swallowClick = false; }, 400); }
    if (ctrl) finish();
    void e;
  };
  for (const t of targets) listen(t);
}
let activeDrag = null;
onContents((c) => activeDrag?.(c.window));

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
  turn(dir, { repeat: e.repeat });
  return true;
}

// ---------- click / tap zones ----------
export function handleClick({ x, y }) {
  if (consumeClick()) return;
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
  turn(isVertical ? dirRight : visual(dirRight), { at: ry });
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

