// Reading settings: defaults, persistence, and the per-book layer.
// Global settings live in settings.json; a book can carry its own overrides
// (book.settings) for the reading keys below, which win while it is open.
import { migrateTemplates } from './presets.js';

export const DEFAULTS = {
  // Typography
  font: 'Literata',
  fontSize: 19,
  fontWeight: 400,
  boldWeight: 700,
  lineHeight: 1.6,
  letterSpacing: 0, // em
  wordSpacing: 0, // em
  paragraphSpacing: 0.4, // em between paragraphs
  paragraphIndent: 1.4, // em first-line indent
  textAlign: 'justify', // publisher | left | justify | center
  wordBreaks: 'auto', // auto | book | never: splitting words across lines
  headingFont: 'same', // same | publisher | <font name>
  headingScale: 1,
  publisherStyles: 'mix', // respect | mix | override
  keepPublisherColors: false,
  fontSmoothing: 'auto', // auto | antialiased | subpixel
  textShadow: 0, // px, faux weight for thin fonts on dark themes
  dropCaps: false,
  smallCapsHeadings: false,
  ligatures: true,
  oldStyleNumbers: false,

  // Layout
  flow: 'paginated', // paginated | scrolled | continuous
  spread: 'auto', // auto | none | always
  marginH: 72,
  marginV: 36,
  lineLength: 66, // characters per line; 130 = no limit
  columnGap: 64,
  imageFit: 'contain', // contain | width | original
  dimImages: 0, // 0-60 %
  invertImagesInDark: false,

  // Colors & atmosphere
  theme: 'paper',
  customThemes: [],
  brightness: 100, // 30-100
  warmth: 0, // 0-100 night-light overlay
  paperTexture: 35, // 0-100 strength of the paper texture
  paperType: 'cotton', // see paper.js
  paperScale: 1,
  paperImage: '',
  spineShadow: true,
  creaseWidth: 50, // 0-100
  deskX: 0, // desk at each side of the page, % of the window width (0-25)
  deskY: 0, // desk above and below the page, % of the window height (0-15)
  deskColor: '', // '' = a shade darker than the page
  barColor: '', // top & bottom bars; '' = a shade darker than the page
  pageRadius: 0, // px: rounded outer corners of the page (with a desk)
  userLayouts: [], // saved page layouts
  userTextStyles: [], // saved text styles
  userColorPresets: [], // saved color presets
  themeOverrides: {}, // built-in themes whose colors the reader changed: id → { bg, fg, link, accent }
  barLineColor: '', // the line between the bars and the page; '' = worked out from the bar color
  creaseDepth: 45, // 0-100: how dark the crease between two pages is
  vignette: 0, // 0-100
  autoDarkTheme: '', // theme used when the OS is in dark mode ('' = off)
  lastLightTheme: 'paper', // for the C (day/night) shortcut
  lastDarkTheme: 'night',

  // Page turning
  pageAnimation: 'curl', // none | curl | flip | slide | push | cover | fade | zoom | rise
  animationMs: 280,
  curlFrom: 'auto', // auto (nearest the click) | bottom | middle | top: which corner leads the curl
  clickZones: 'thirds', // thirds | halves | left-third | all-next | top-bottom | kindle | off
  invertZones: false,
  wheelTurns: true,
  wheelInvert: false,
  swipeTurns: true,
  keyArrows: true,
  keySpace: true,
  keyPage: true,
  keyVim: true,
  keyWasd: false,
  keyMedia: true,
  gamepad: true,
  autoTurnSeconds: 30,
  autoScrollSpeed: 40, // px per second
  autoPauseOnInteract: true,
  doubleTapFullscreen: false,

  // Chrome
  showHeader: true,
  showFooter: true,
  footerLeft: 'chapter', // chapter | title | time | none
  footerCenter: 'page', // page | chapter-left | book-left | percent | none
  footerRight: 'percent', // percent | clock | book-left | page | none
  showScrubber: true,
  hideChromeWhileReading: true,

  // Focus aids
  ruler: 'off', // off | line | band | spotlight | underline
  rulerLines: 3,
  rulerOpacity: 30,
  fixation: false, // bionic-style emphasis (dims word endings)
  fixationStrength: 45,

  // Highlights
  highlightColor: 'yellow',
  highlightStyle: 'highlight',
  highlightOpacity: 45,
  quickHighlight: false, // highlight immediately on selection
  customHighlightColors: [],
  highlightOverrides: {}, // built-in highlight colors the reader has changed: id → hex

  // Speech
  ttsVoice: '',
  ttsRate: 1,
  ttsPitch: 1,
  ttsFollow: true,

  // Stats
  dailyGoalMinutes: 30,
  idleSeconds: 90,
  defaultWpm: 250,

  // Library
  libraryView: 'grid',
  librarySort: 'recent',
  libraryCardSize: 160,
  rememberPerBook: false,

};

// Keys that a book may override (everything visual about reading).
export const BOOK_KEYS = Object.keys(DEFAULTS).filter((k) =>
  !['customThemes', 'customHighlightColors', 'highlightOverrides', 'userLayouts', 'userTextStyles', 'userColorPresets', 'themeOverrides', 'libraryView', 'librarySort', 'libraryCardSize',
    'dailyGoalMinutes', 'idleSeconds', 'defaultWpm', 'rememberPerBook'].includes(k));

let global = { ...DEFAULTS };
let bookLayer = null; // { book, overrides }
const listeners = new Set();

export async function loadSettings() {
  const saved = await window.api.settings.get();
  global = { ...DEFAULTS, ...saved };
  // animations renamed in 1.1
  if ('hyphenation' in global) {
    if (!saved.wordBreaks) global.wordBreaks = global.hyphenation === false ? 'book' : 'auto';
    delete global.hyphenation;
  }
  // page size was briefly 'pageWidth' (%) and 'pageInsetY' (px)
  if ('pageWidth' in saved || 'pageInsetY' in saved) {
    if (!('deskX' in saved)) global.deskX = Math.max(0, (100 - (saved.pageWidth ?? 100)) / 2);
    if (!('deskY' in saved)) global.deskY = Math.round(((saved.pageInsetY ?? 0) / 10)) ;
    delete global.pageWidth; delete global.pageInsetY;
  }
  if ('userTemplates' in saved) {
    migrateTemplates(saved, global);
    window.api.settings.set(global); // write the split right away, so it happens once
  }
  const renamed = { peel: 'curl', blur: 'fade' };
  if (renamed[global.pageAnimation]) global.pageAnimation = renamed[global.pageAnimation];
  return global;
}

export function getSettings() {
  return bookLayer ? { ...global, ...bookLayer.overrides } : global;
}

export function getGlobal() { return global; }

export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Changes are delivered at most once per frame, so dragging a slider
// restyles the book once per frame rather than once per input event.
let pendingKeys = new Set();
let emitRaf = 0;
function emit(changed) {
  for (const k of changed) pendingKeys.add(k);
  if (emitRaf) return;
  emitRaf = requestAnimationFrame(() => {
    emitRaf = 0;
    const keys = [...pendingKeys];
    pendingKeys = new Set();
    const s = getSettings();
    for (const fn of listeners) fn(s, keys);
  });
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.settings.set(global), 250);
}

// Set reading settings. Goes to the open book when it is in per-book mode.
export function setSettings(patch, { scope } = {}) {
  const changed = Object.keys(patch);
  const toBook = bookLayer && (scope === 'book' || (scope !== 'global' && bookLayer.book.perBook));
  if (toBook) {
    const bookPatch = {}, globalPatch = {};
    for (const k of changed) (BOOK_KEYS.includes(k) ? bookPatch : globalPatch)[k] = patch[k];
    Object.assign(bookLayer.overrides, bookPatch);
    Object.assign(global, globalPatch);
    window.api.library.upsert(bookLayer.book.id, { settings: bookLayer.overrides });
  } else {
    Object.assign(global, patch);
  }
  persist();
  emit(changed);
}

export function attachBook(book) {
  bookLayer = { book, overrides: { ...(book.settings || {}) } };
  emit(Object.keys(bookLayer.overrides));
}

export function detachBook() {
  const had = bookLayer ? Object.keys(bookLayer.overrides) : [];
  bookLayer = null;
  if (had.length) emit(had);
}

export function setBookScope(on) {
  if (!bookLayer) return;
  bookLayer.book.perBook = on;
  if (on && !Object.keys(bookLayer.overrides).length) {
    for (const k of BOOK_KEYS) bookLayer.overrides[k] = global[k];
  }
  if (!on) bookLayer.overrides = {};
  window.api.library.upsert(bookLayer.book.id, { perBook: on, settings: bookLayer.overrides });
  emit(BOOK_KEYS);
}

export function bookScopeActive() { return !!bookLayer?.book.perBook; }

export function resetSettings(keys) {
  const patch = {};
  for (const k of keys) patch[k] = DEFAULTS[k];
  setSettings(patch);
}
