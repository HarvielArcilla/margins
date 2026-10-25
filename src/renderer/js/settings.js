// Reading settings: defaults, persistence, and the per-book layer.
// Global settings live in settings.json; a book can carry its own overrides
// (book.settings) for the reading keys below, which win while it is open.

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
  hyphenation: true,
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

  // Colours & atmosphere
  theme: 'paper',
  customThemes: [],
  brightness: 100, // 30-100
  warmth: 0, // 0-100 night-light overlay
  paperTexture: 0, // 0-100
  vignette: 0, // 0-100
  autoDarkTheme: '', // theme used when the OS is in dark mode ('' = off)
  lastLightTheme: 'paper', // for the C (day/night) shortcut
  lastDarkTheme: 'night',

  // Page turning
  pageAnimation: 'curl', // none | curl | flip | slide | push | cover | fade | zoom | rise
  animationMs: 280,
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

  userTemplates: [],
};

// Keys that a book may override (everything visual about reading).
export const BOOK_KEYS = Object.keys(DEFAULTS).filter((k) =>
  !['customThemes', 'userTemplates', 'customHighlightColors', 'libraryView', 'librarySort', 'libraryCardSize',
    'dailyGoalMinutes', 'idleSeconds', 'defaultWpm', 'rememberPerBook'].includes(k));

let global = { ...DEFAULTS };
let bookLayer = null; // { book, overrides }
const listeners = new Set();

export async function loadSettings() {
  const saved = await window.api.settings.get();
  global = { ...DEFAULTS, ...saved };
  // animations renamed in 1.1
  const renamed = { peel: 'curl', blur: 'fade' };
  if (renamed[global.pageAnimation]) global.pageAnimation = renamed[global.pageAnimation];
  return global;
}

export function getSettings() {
  return bookLayer ? { ...global, ...bookLayer.overrides } : global;
}

export function getGlobal() { return global; }

export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit(changed) {
  const s = getSettings();
  for (const fn of listeners) fn(s, changed);
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
