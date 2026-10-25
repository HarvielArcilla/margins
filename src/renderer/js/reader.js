// The reader: opens a book with epub.js, lays it out, styles its pages, and
// tracks where you are. Page turning, annotations, stats and speech plug in
// through the hooks below.
import { $, setChildren, el, debounce, toast, countWords, clamp } from './ui.js';
import { getSettings, onSettings, attachBook, detachBook } from './settings.js';
import { findTheme, applyChromeTheme, isDark } from './themes.js';
import { applyPageCss } from './page-style.js';
import * as annotations from './annotations.js';
import * as turner from './pageturn.js';
import * as stats from './stats.js';
import * as tts from './tts.js';
import * as sidebar from './sidebar.js';
import * as focus from './focus.js';
import { schedulePrepare, invalidate as invalidateSnapshot } from './turn-anim.js';
import { idle, perFrame } from './perf.js';
import * as paper from './paper.js';

export const R = {
  meta: null, // library record
  book: null, // epub.js Book
  rendition: null,
  toc: [], // flattened [{label, href, depth, spineIndex, id}]
  location: null,
  cache: {}, // { locations, sectionWords }
  rtl: false,
  open: false,
  cols: 1,
};

let unsubscribeSettings = null;
// A function (not a const) so modules in an import cycle can register
// before this module body has run.
function contentsHooks() { return contentsHooks.set || (contentsHooks.set = new Set()); }

export function onContents(fn) { contentsHooks().add(fn); }

export function liveContents() {
  try { return R.rendition ? R.rendition.getContents() : []; } catch { return []; }
}

// ---------- open / close ----------
export async function openBook(meta, { at } = {}) {
  if (R.open) await closeBook({ keepView: true });
  R.meta = meta;
  R.open = true;
  document.body.dataset.view = 'reader';
  $('#reader-title').textContent = meta.title || 'Untitled';
  $('#reader-loading').hidden = false;
  attachBook(meta);
  applyTheme();

  const bytes = await window.api.library.read(meta.id);
  R.book = window.ePub(bytes);
  await R.book.ready;
  R.rtl = (R.book.package?.metadata?.direction || R.book.package?.spine?.direction) === 'rtl'
    || R.book.packaging?.metadata?.direction === 'rtl';
  R.cache = await window.api.bookCache.get(meta.id);
  const nav = await R.book.loaded.navigation;
  R.toc = flattenToc(nav.toc || []);

  await annotations.load(meta.id);
  await createRendition(at === 0 ? undefined : (at || meta.cfi));
  $('#reader-loading').hidden = true;
  unsubscribeSettings = onSettings(onSettingsChanged);
  stats.startSession(meta);
  sidebar.bookOpened();
  window.api.library.upsert(meta.id, { lastOpenedAt: Date.now() });
  // measuring the book can wait until the first page is up and things are quiet
  idle(1500).then(() => { if (R.meta?.id === meta.id) prepareBackgroundData(); });
}

export async function closeBook({ keepView = false } = {}) {
  if (!R.open) return;
  tts.stop();
  turner.stopAuto();
  saveProgress.flush();
  await stats.endSession();
  unsubscribeSettings?.();
  try { R.rendition?.destroy(); } catch { /* already gone */ }
  const oldBook = R.book;
  // let any page still loading finish before tearing the book down
  setTimeout(() => { try { oldBook?.destroy(); } catch { /* already gone */ } }, 1500);
  Object.assign(R, { meta: null, book: null, rendition: null, toc: [], location: null, anchor: null, open: false, cache: {} });
  setChildren($('#book'));
  detachBook();
  annotations.reset();
  sidebar.close();
  if (!keepView) applyTheme();
}

function flattenToc(items, depth = 0, out = []) {
  for (const it of items) {
    out.push({ id: it.id, label: (it.label || '').trim(), href: it.href, depth, spineIndex: -1 });
    if (it.subitems?.length) flattenToc(it.subitems, depth + 1, out);
  }
  return out;
}

function resolveTocSpine() {
  for (const t of R.toc) {
    const sec = R.book.spine.get(t.href?.split('#')[0]) || R.book.spine.get(t.href);
    t.spineIndex = sec ? sec.index : -1;
  }
}

// ---------- rendition ----------
// Works out the page geometry for the stage size and settings:
// - side and top margins shrink on small windows instead of eating the page
// - line length is in characters, so it scales with the font size
// - in "auto", two pages appear only when each can hold a comfortable line
// - the text block is centred, and the footer lines up with its edges
export function layoutFor(s, stageEl = $('#stage')) {
  const W = stageEl.W ?? stageEl.clientWidth, H = stageEl.H ?? stageEl.clientHeight;
  const fs = s.fontSize;
  const paginated = s.flow === 'paginated';
  const m = Math.round(Math.min(s.marginH, Math.max(14, W * 0.055)));
  const mv = Math.round(Math.min(s.marginV, Math.max(6, H * 0.035)));
  const measure = s.lineLength > 0 && s.lineLength < 130 ? s.lineLength * fs * 0.5 : Infinity;
  const gap = paginated ? even(Math.max(s.columnGap, fs * 2)) : 0;
  let cols = 1;
  if (paginated && s.spread === 'always') cols = 2;
  else if (paginated && s.spread === 'auto') {
    const perPage = (W - 2 * m + gap) / 2 - gap;
    cols = perPage >= Math.max(300, Math.min(measure, fs * 34) * 0.88) ? 2 : 1;
  }
  // epub.js puts half the gap inside each edge of each page
  const avail = W - 2 * m + gap;
  let textW, width, inset;
  if (paginated) {
    textW = Math.max(160, Math.min(measure, avail / cols - gap));
    width = even(Math.min(W, cols * (textW + gap)));
    inset = gap / 2;
  } else {
    // scroll modes: epub.js pads the page by a twelfth of its width each side
    textW = Math.max(160, Math.min(measure, W - 2 * m));
    width = even(Math.min(W, textW * 1.2));
    inset = width / 12;
  }
  const padX = Math.max(0, Math.floor((W - width) / 2));
  const height = Math.max(120, H - 2 * mv);
  return { cols, gap, padX, padY: mv, width, height, inset: Math.round(inset), textW: Math.round(textW), W, H };
}

const even = (n) => 2 * Math.round(n / 2);

// The page can be smaller than the window, with a "desk" around it: the
// stage (the page area, which is also what page turns picture) shrinks.
export function applyPageSize(s = getSettings()) {
  const rv = $('#reader-view');
  const dx = Math.max(0, Math.min(25, s.deskX ?? 0));
  const dy = Math.max(0, Math.min(15, s.deskY ?? 0));
  // whole pixels, so the page's edges (and its pictures) stay crisp
  rv.style.setProperty('--desk-x', `${Math.round((window.innerWidth * dx) / 100)}px`);
  rv.style.setProperty('--desk-y', `${Math.round((window.innerHeight * dy) / 100)}px`);
  rv.classList.toggle('has-desk', dx > 0 || dy > 0);
  if (s.deskColor) rv.style.setProperty('--desk', s.deskColor); else rv.style.removeProperty('--desk');
  if (s.barColor) rv.style.setProperty('--bar', s.barColor); else rv.style.removeProperty('--bar');
  // rounded outer corners only make sense with a desk to round them against
  const radius = dx > 0 || dy > 0 ? Math.max(0, Math.min(32, s.pageRadius || 0)) : 0;
  rv.style.setProperty('--page-radius', `${radius}px`);
  R.pageRadius = radius;
}

function placeBook(L) {
  const book = $('#book');
  Object.assign(book.style, { left: `${L.padX}px`, top: `${L.padY}px`, width: `${L.width}px`, height: `${L.height}px` });
  const rv = $('#reader-view').style;
  // footer and header text line up with the text block, not the window
  const st = $('#stage').getBoundingClientRect(), all = $('#reader-view').getBoundingClientRect();
  rv.setProperty('--text-left', `${st.left - all.left + L.padX + L.inset}px`);
  rv.setProperty('--text-right', `${all.right - st.right + L.padX + L.inset}px`);
  R.layout = L;
  paper.placeSpine(L, 0);
}

async function createRendition(at) {
  const s = getSettings();
  applyPageSize(s);
  const L = layoutFor(s);
  R.cols = L.cols;
  R.gap = L.gap;
  placeBook(L);
  try { R.rendition?.destroy(); } catch { /* ignore */ }
  setChildren($('#book'));
  document.body.dataset.flow = s.flow;

  // Fixed pixel sizes: epub.js then doesn't re-render on every window resize
  // event (which flickers while dragging); we resize it once, when it settles.
  const opts = {
    width: L.width,
    height: L.height,
    allowScriptedContent: false,
    spread: L.cols === 2 ? 'always' : 'none',
    minSpreadWidth: 0,
    resizeOnOrientationChange: false,
  };
  if (s.flow === 'paginated') Object.assign(opts, { flow: 'paginated', manager: 'default', gap: L.gap });
  else if (s.flow === 'scrolled') Object.assign(opts, { flow: 'scrolled-doc', manager: 'default' });
  else Object.assign(opts, { flow: 'scrolled', manager: 'continuous' });

  const rendition = R.book.renderTo($('#book'), opts);
  R.rendition = rendition;
  rendition.hooks.content.register((contents) => onContentReady(contents));
  rendition.on('relocated', onRelocated);
  rendition.on('displayError', (e) => console.warn('display error', e));
  try {
    await rendition.display(at || undefined);
  } catch (e) {
    console.warn('could not display saved position, starting at the beginning', e);
    await rendition.display();
  }
  if (!R.toc.some((t) => t.spineIndex >= 0)) resolveTocSpine();
}

// After a layout change, make sure the page on screen contains the anchor;
// if the first display landed before layout finished, show it again.
async function settleOn(cfi) {
  if (!cfi || !R.rendition) return;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (!cfiOnPage(cfi, R.location)) await R.rendition.display(cfi);
}

function cfiOnPage(cfi, loc) {
  if (!cfi || !loc) return false;
  try {
    const c = new window.ePub.CFI();
    return c.compare(cfi, loc.start.cfi) >= 0 && c.compare(cfi, loc.end.cfi) <= 0;
  } catch { return false; }
}

let relayoutBusy = false;
let relayoutAgain = false;
export async function relayout({ recreate = false } = {}) {
  if (!R.rendition) return;
  if (relayoutBusy) { relayoutAgain = true; return; }
  relayoutBusy = true;
  try {
    const s = getSettings();
    // The anchor is where the reader actually is; it doesn't drift when the
    // page boundaries move during a relayout.
    const cfi = R.anchor || R.location?.start?.cfi;
    R.relayouting = true;
    const L = layoutFor(s);
    const prev = R.layout;
    const sameBox = prev && prev.width === L.width && prev.height === L.height;
    if (recreate || !sameBox || L.cols !== R.cols || L.gap !== R.gap) {
      // A new size means new page breaks; rebuilding the rendition is more
      // reliable than epub.js's in-place resize, which can re-display an
      // earlier position after the fact.
      await createRendition(cfi);
    } else if (cfi) {
      await R.rendition.display(cfi);
    }
    await settleOn(cfi);
  } finally {
    relayoutBusy = false;
    R.relayouting = false;
  }
  if (relayoutAgain) { relayoutAgain = false; relayout(); }
}

// While the window is being dragged, keep the page still and blank out to
// the page colour; lay out once when resizing stops.
const onWindowResize = debounce(async () => {
  await relayout();
  $('#reader-view').classList.remove('resizing');
}, 200);
window.addEventListener('resize', () => {
  if (!R.open) return;
  invalidateSnapshot();
  applyPageSize();
  $('#reader-view').classList.add('resizing');
  onWindowResize();
});

// ---------- page content ----------
function onContentReady(contents) {
  styleContents(contents);
  attachContentListeners(contents);
  for (const fn of contentsHooks()) {
    try { fn(contents); } catch (e) { console.error(e); }
  }
}

function styleContents(contents) {
  const s = getSettings();
  applyPageCss(contents, s, R.theme || findTheme(s));
}

function attachContentListeners(contents) {
  const doc = contents.document;
  const frame = () => doc.defaultView.frameElement;
  const toTop = (e) => {
    const r = frame().getBoundingClientRect();
    return { x: r.left + e.clientX, y: r.top + e.clientY };
  };
  doc.addEventListener('wheel', (e) => turner.handleWheel(e), { passive: false });
  doc.addEventListener('mousemove', (e) => { const p = toTop(e); onPointer(p.y); });
  doc.addEventListener('mousedown', (e) => turner.handlePointerDown(toTop(e), e, doc));
  doc.addEventListener('mouseup', (e) => setTimeout(() => annotations.onMouseUp(contents, e, toTop(e)), 0));
  doc.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    if (e.target.closest?.('a[href]')) return; // epub.js follows internal links
    const sel = doc.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (annotations.onClick(contents, e, toTop(e))) return;
    turner.handleClick(toTop(e));
  });
  doc.addEventListener('dblclick', () => { if (getSettings().doubleTapFullscreen) window.api.window.fullscreen(); });
  let touch = null;
  doc.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; touch = { x: t.clientX, y: t.clientY, t: Date.now() }; }, { passive: true });
  doc.addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    turner.handleSwipe(t.clientX - touch.x, t.clientY - touch.y, Date.now() - touch.t);
    touch = null;
  }, { passive: true });
}

export function restyleAll() {
  for (const c of liveContents()) styleContents(c);
}

// ---------- chrome / theme ----------
export function applyTheme() {
  const s = getSettings();
  let theme = findTheme(s);
  if (s.autoDarkTheme && matchMedia('(prefers-color-scheme: dark)').matches && !isDark(theme)) {
    theme = findTheme({ ...s, theme: s.autoDarkTheme });
  }
  R.theme = theme;
  applyChromeTheme(theme);
  const rv = $('#reader-view');
  // Overlays at zero strength are removed entirely rather than left as
  // invisible full-window layers the GPU still has to composite.
  const fx = {
    dim: 1 - s.brightness / 100,
    warm: (s.warmth / 100) * 0.22,
    vignette: s.vignette / 100,
  };
  for (const [k, v] of Object.entries(fx)) {
    rv.style.setProperty(`--fx-${k}`, String(v));
    const node = rv.querySelector(`.fx-${k}`);
    if (node) node.hidden = v <= 0.001;
  }
  paper.apply(s, isDark(theme));
  applyPageSize(s);
  rv.classList.toggle('no-header', !s.showHeader);
  rv.classList.toggle('no-footer', !s.showFooter);
  rv.classList.toggle('immersive', !!s.hideChromeWhileReading);
  return theme;
}

let chromeTimer = null;
export function showChrome(on = true) {
  const rv = $('#reader-view');
  rv.classList.toggle('show-chrome', on);
  clearTimeout(chromeTimer);
}
export function toggleChrome() { showChrome(!$('#reader-view').classList.contains('show-chrome')); }

let peek = '';
function revealChromeNear(y) {
  const rv = $('#reader-view');
  if (!rv.classList.contains('immersive')) return;
  const next = y < 70 ? 'top' : y > innerHeight - 60 ? 'bottom' : '';
  if (next === peek) return; // only touch classes when something changes
  peek = next;
  rv.classList.toggle('peek-top', next === 'top');
  rv.classList.toggle('peek-bottom', next === 'bottom');
}
// pointer moves arrive far faster than frames; handle at most one per frame
const onPointer = perFrame((y) => { if (!R.open) return; revealChromeNear(y); focus.pointer(y); stats.activity(); });
document.addEventListener('mousemove', (e) => onPointer(e.clientY));

const RECREATE_KEYS = new Set(['flow']);
const RELAYOUT_KEYS = new Set(['deskX', 'deskY', 'spread', 'columnGap', 'marginH', 'marginV', 'lineLength', 'fontSize', 'lineHeight', 'font', 'letterSpacing',
  'wordSpacing', 'paragraphSpacing', 'paragraphIndent', 'publisherStyles', 'fontWeight', 'headingFont', 'headingScale',
  'imageFit', 'textAlign', 'wordBreaks', 'dropCaps', 'smallCapsHeadings']);

const relayoutSoon = debounce(() => relayout(), 220);

// Settings that don't change how a page looks, so the pictures of the pages
// kept for turning stay good.
const UNSEEN_KEYS = /^(deskColor|barColor|pageRadius|pageAnimation|animationMs|curlFrom|key[A-Z]|clickZones|invertZones|doubleTap|wheel|swipe|gamepad|autoTurn|autoScroll|autoPause|tts)/;

function onSettingsChanged(s, changed) {
  if (!R.open) return;
  if (!changed || [...changed].some((k) => !UNSEEN_KEYS.test(k))) invalidateSnapshot();
  else schedulePrepare();
  applyTheme();
  restyleAll();
  annotations.restyle();
  focus.refresh();
  if (changed.some((k) => RECREATE_KEYS.has(k))) relayout({ recreate: true });
  else if (changed.some((k) => RELAYOUT_KEYS.has(k))) relayoutSoon();
  updateFooter();
}

// ---------- location ----------
function onRelocated(location) {
  const prev = R.location;
  R.location = location;
  // Keep the anchor while it is still on screen (relayouts, late events);
  // once the reader moves to a page without it, the new page becomes it.
  if (!R.relayouting && !cfiOnPage(R.anchor, location)) R.anchor = location.start.cfi;
  updateFooter();
  saveProgress();
  schedulePrepare();
  sidebar.locationChanged();
  annotations.locationChanged();
  if (prev && prev.start.cfi !== location.start.cfi) stats.pageTurn(location);
  if (location.atEnd && !R.meta.finishedAt) {
    R.meta.finishedAt = Date.now();
    window.api.library.upsert(R.meta.id, { finishedAt: R.meta.finishedAt });
    toast('You reached the end — marked as finished');
  }
}

const saveProgress = debounce(() => {
  if (!R.meta || !R.location) return;
  const pct = percentage();
  const patch = { cfi: R.location.start.cfi, progress: pct ?? R.meta.progress ?? 0, lastReadAt: Date.now(), chapter: currentChapter()?.label || '' };
  Object.assign(R.meta, patch);
  window.api.library.upsert(R.meta.id, patch);
}, 600);

export function percentage(loc = R.location) {
  if (!loc) return null;
  if (R.book?.locations?.length?.()) {
    const p = R.book.locations.percentageFromCfi(loc.start.cfi);
    if (typeof p === 'number' && !Number.isNaN(p)) return p;
  }
  // Fallback before locations exist: spine position plus page within section.
  const n = R.book?.spine?.spineItems?.length || 1;
  const d = loc.start.displayed || { page: 1, total: 1 };
  return clamp((loc.start.index + (d.page - 1) / Math.max(1, d.total)) / n, 0, 1);
}

export function currentChapter(loc = R.location) {
  if (!loc || !R.toc.length) return null;
  const idx = loc.start.index;
  const href = loc.start.href;
  let best = null;
  for (const t of R.toc) {
    if (t.spineIndex < 0) continue;
    if (t.spineIndex <= idx) { if (!best || t.spineIndex >= best.spineIndex) best = t; }
  }
  return R.toc.find((t) => t.href && href && t.href.split('#')[0] === href) || best;
}

function nextChapterSpine(ch) {
  if (!ch) return Infinity;
  const later = R.toc.filter((t) => t.spineIndex > ch.spineIndex).map((t) => t.spineIndex);
  return later.length ? Math.min(...later) : Infinity;
}

// Minutes left in the chapter and the book, from word counts and your pace.
export function timeLeft() {
  const words = R.cache.sectionWords;
  const loc = R.location;
  if (!words || !loc) return null;
  const wpm = stats.paceFor(R.meta?.id) || getSettings().defaultWpm;
  const idx = loc.start.index;
  const d = loc.start.displayed || { page: 1, total: 1 };
  const frac = d.total > 0 ? (d.page - 1) / d.total : 0;
  const here = (words[idx] || 0) * (1 - frac);
  const ch = currentChapter();
  const end = Math.min(nextChapterSpine(ch), words.length);
  let chapterWords = here, bookWords = here;
  for (let i = idx + 1; i < words.length; i++) {
    bookWords += words[i] || 0;
    if (i < end) chapterWords += words[i] || 0;
  }
  return { chapter: chapterWords / wpm, book: bookWords / wpm, wpm };
}

const fmtMin = (m) => {
  if (m == null) return '';
  if (m < 1) return 'less than a minute';
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return r ? `${h} h ${r} min` : `${h} h`;
};

export function updateFooter() {
  if (!R.open || !R.location) return;
  const s = getSettings();
  const loc = R.location;
  const pct = percentage();
  const ch = currentChapter();
  const tl = timeLeft();
  const d = loc.start.displayed || {};
  const parts = {
    chapter: ch?.label || '',
    title: R.meta.title || '',
    time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    clock: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    page: s.flow === 'paginated' && d.total ? `Page ${d.page} of ${d.total} in chapter` : (ch?.label ? '' : ''),
    'chapter-left': tl ? `${fmtMin(tl.chapter)} left in chapter` : '',
    'book-left': tl ? `${fmtMin(tl.book)} left in book` : '',
    percent: pct != null ? `${Math.round(pct * 100)}%` : '',
    none: '',
  };
  $('#footer-left').textContent = parts[s.footerLeft] ?? '';
  $('#footer-center').textContent = parts[s.footerCenter] ?? '';
  $('#footer-right').textContent = parts[s.footerRight] ?? '';
  $('#reader-chapter').textContent = ch?.label || '';
  const scrub = $('#scrubber');
  if (pct != null && !scrub.matches(':active')) scrub.value = String(Math.round(pct * 1000));
  $('#scrub-fill').style.width = `${(pct || 0) * 100}%`;
  $('#bm-btn').classList.toggle('active', annotations.isBookmarked());
}
setInterval(() => { if (R.open) updateFooter(); }, 30000);

// ---------- navigation ----------
export function next() { return R.rendition?.next(); }
export function prev() { return R.rendition?.prev(); }

export async function goTo(target) {
  if (!R.rendition) return;
  stats.activity();
  await R.rendition.display(target);
}

export async function goToPercent(p) {
  if (!R.book?.locations?.length?.()) { toast('Still measuring the book — try again in a moment'); return; }
  const cfi = R.book.locations.cfiFromPercentage(clamp(p, 0, 1));
  await goTo(cfi);
}

// Text and range of what is on screen now.
export async function visibleRange() {
  const loc = R.location;
  if (!loc) return null;
  for (const c of liveContents()) {
    if (c.sectionIndex !== loc.start.index) continue;
    try {
      const start = c.range(loc.start.cfi);
      let endRange = null;
      try { if (loc.end.index === loc.start.index) endRange = c.range(loc.end.cfi); } catch { /* end in other section */ }
      const r = c.document.createRange();
      r.setStart(start.startContainer, start.startOffset);
      if (endRange) r.setEnd(endRange.endContainer, endRange.endOffset);
      else r.setEnd(c.document.body, c.document.body.childNodes.length);
      return { range: r, contents: c };
    } catch { /* fall through */ }
  }
  return null;
}

// ---------- background measurement ----------
async function prepareBackgroundData() {
  const book = R.book;
  const id = R.meta.id;
  try {
    if (R.cache.locations) {
      book.locations.load(R.cache.locations);
    } else {
      // measure section by section in idle time, pausing for animations
      const loc = book.locations;
      const process = loc.process.bind(loc);
      loc.process = async (section) => { await idle(); return R.book === book ? process(section) : undefined; };
      await idle(1500);
      await book.locations.generate(1200);
      if (R.book !== book) return;
      R.cache.locations = book.locations.save();
    }
    updateFooter();
    sidebar.locationChanged();
    if (!R.cache.sectionWords) {
      const words = [];
      for (const item of book.spine.spineItems) {
        if (R.book !== book) return;
        try {
          const doc = await item.load(book.load.bind(book));
          words[item.index] = countWords(doc.textContent || doc.innerText || '');
          item.unload();
        } catch { words[item.index] = 0; }
        await idle();
      }
      R.cache.sectionWords = words;
      const total = words.reduce((a, b) => a + (b || 0), 0);
      window.api.library.upsert(id, { words: total });
      if (R.meta) R.meta.words = total;
    }
    window.api.bookCache.set(id, R.cache);
    updateFooter();
  } catch (e) {
    console.warn('background measurement failed', e);
  }
}

export function bookInfo() {
  const m = R.meta;
  return el('div.book-info',
    el('dl',
      el('dt', 'Title'), el('dd', m.title || ''),
      el('dt', 'Author'), el('dd', m.author || '—'),
      m.publisher ? [el('dt', 'Publisher'), el('dd', m.publisher)] : null,
      m.language ? [el('dt', 'Language'), el('dd', m.language)] : null,
      m.words ? [el('dt', 'Length'), el('dd', `${m.words.toLocaleString()} words · about ${fmtMin(m.words / (stats.paceFor(m.id) || getSettings().defaultWpm))} at your pace`)] : null,
      el('dt', 'Progress'), el('dd', `${Math.round((m.progress || 0) * 100)}%`),
      el('dt', 'Time spent'), el('dd', fmtMin(stats.timeForBook(m.id) / 60000) || 'not yet')),
    m.description ? el('div.desc', { html: sanitizeHtml(m.description) }) : null);
}

function sanitizeHtml(html) {
  const d = new DOMParser().parseFromString(String(html), 'text/html');
  d.querySelectorAll('script,style,iframe,object,embed,link').forEach((n) => n.remove());
  d.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((a) => { if (a.name !== 'href') n.removeAttribute(a.name); }));
  return d.body.innerHTML;
}
