// Boot, views, the top bar, keyboard shortcuts and menu commands.
import { $, setChildren, el, icon, modal, toast, closeMenus, closeTopModal } from './ui.js';
import { loadSettings, getSettings, setSettings } from './settings.js';
import { loadFonts } from './fonts.js';
import { allThemes, isDark } from './themes.js';
import { allPresets, presetPatch } from './presets.js';
import * as library from './library.js';
import * as reader from './reader.js';
import * as stats from './stats.js';
import * as sidebar from './sidebar.js';
import * as panel from './settings-panel.js';
import * as turner from './pageturn.js';
import * as annotations from './annotations.js';
import * as tts from './tts.js';

const R = reader.R;

async function boot() {
  const [info, gfx] = await Promise.all([window.api.info(), window.api.graphics.get()]);
  document.body.classList.add(`platform-${info.platform}`);
  // lighter effects when the window is drawn without a GPU
  document.documentElement.dataset.gpu = gfx.active?.hardwareAcceleration ? 'on' : 'off';
  await Promise.all([loadSettings(), loadFonts(), stats.loadStats(), library.loadLibrary()]);
  reader.applyTheme();
  wireTopbar();
  library.installDropZone();
  showLibrary();
  window.api.on('menu', onMenu);
  const openPaths = async (paths) => {
    if (!paths.length) return;
    const added = await library.importFiles(paths);
    if (added.length) reader.openBook(added[added.length - 1]);
  };
  window.api.on('library:open-path', (p) => openPaths([p]));
  window.api.on('window:fullscreen', (on) => {
    document.body.classList.toggle('fullscreen', on);
    const fb = $('#fs-btn');
    if (fb) setChildren(fb, icon(on ? 'shrink' : 'expand'));
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { reader.applyTheme(); reader.restyleAll(); });
  document.body.classList.add('ready');
  // Books double-clicked in Finder/Explorer before the window was ready.
  openPaths(await window.api.library.takePending());
}

// ---------- views ----------
export async function showLibrary() {
  if (R.open) await reader.closeBook();
  panel.close();
  document.body.dataset.view = 'library';
  reader.applyTheme();
  await library.loadLibrary();
  library.render();
}

async function showStats() {
  if (R.open) await reader.closeBook();
  panel.close();
  document.body.dataset.view = 'stats';
  reader.applyTheme();
  await stats.renderStatsView(await library.loadLibrary());
}

function wireTopbar() {
  const on = (id, fn) => $(id).addEventListener('click', fn);
  on('#lib-btn', showLibrary);
  on('#stats-btn', showStats);
  on('#import-btn', () => library.pickAndImport());
  on('#lib-settings-btn', () => panel.toggle('theme'));
  on('#back-btn', showLibrary);
  on('#toc-btn', () => sidebar.toggle('toc'));
  on('#bm-btn', () => annotations.toggleBookmark());
  on('#search-btn', () => sidebar.toggle('search'));
  on('#notes-btn', () => sidebar.toggle('notes'));
  on('#tts-btn', () => tts.toggle());
  on('#auto-btn', () => turner.toggleAuto());
  on('#aa-btn', () => panel.toggle());
  on('#focus-btn', toggleFocusMode);
  on('#fs-btn', () => window.api.window.fullscreen());
  on('#reader-title', () => modal({ title: R.meta.title, body: reader.bookInfo(), actions: [{ label: 'Close' }] }));
  const scrub = $('#scrubber');
  scrub.addEventListener('input', () => {
    const p = +scrub.value / 1000;
    $('#scrub-fill').style.width = `${p * 100}%`;
    $('#scrub-tip').textContent = `${Math.round(p * 100)}%`;
  });
  scrub.addEventListener('change', () => reader.goToPercent(+scrub.value / 1000));
  $('#stage').addEventListener('wheel', (e) => turner.handleWheel(e), { passive: false });
  $('#stage').addEventListener('click', (e) => { if (e.target.closest('#viewer iframe')) return; turner.handleClick({ x: e.clientX, y: e.clientY }); });
  $('#stage').addEventListener('mousedown', (e) => { if (e.target.closest('#viewer iframe')) return; turner.handlePointerDown({ x: e.clientX, y: e.clientY }, e, document); });
}

function toggleFocusMode() {
  const on = document.body.classList.toggle('focus-mode');
  toast(on ? 'Focus mode — press Z or Esc to leave' : 'Focus mode off');
}

// ---------- menu commands ----------
function onMenu(cmd) {
  closeMenus();
  switch (cmd) {
    case 'import': library.pickAndImport(); break;
    case 'library': showLibrary(); break;
    case 'stats': showStats(); break;
    case 'settings': panel.toggle(); break;
    case 'toc': if (R.open) sidebar.toggle('toc'); break;
    case 'search': if (R.open) sidebar.open('search'); break;
    case 'focus': if (R.open) toggleFocusMode(); break;
    case 'shortcuts': shortcutsHelp(); break;
    case 'export-annotations': annotations.exportAnnotations('md'); break;
    default: break;
  }
}

// ---------- keyboard ----------
function themeFlip() {
  const s = getSettings();
  const themes = allThemes(s);
  const cur = themes.find((t) => t.id === s.theme) || themes[0];
  if (isDark(cur)) setSettings({ lastDarkTheme: cur.id, theme: s.lastLightTheme || 'paper' });
  else setSettings({ lastLightTheme: cur.id, theme: s.lastDarkTheme || 'night' });
}

function goToDialog() {
  const cur = Math.round((reader.percentage() || 0) * 100);
  const input = el('input.input', { type: 'number', min: 0, max: 100, value: cur });
  modal({
    title: 'Go to',
    body: [el('label.field', el('span', 'Percent through the book'), input),
      R.toc.length ? el('p.hint', 'Tip: press T for the table of contents.') : null],
    actions: [{ label: 'Cancel' }, { label: 'Go', primary: true, onclick: () => reader.goToPercent((+input.value || 0) / 100) }],
  });
}

const SHORTCUTS = [
  ['Turning pages', [['→  Space  PgDn  J  L', 'Next page'], ['←  Shift+Space  PgUp  K  H', 'Previous page'], ['P', 'Start/stop auto-turn or auto-scroll'], ['[  ]', 'Slower / faster auto'], ['G', 'Go to a percentage']]],
  ['Panels', [['T', 'Contents'], ['N', 'Highlights & notes'], ['/  Ctrl+F', 'Search the book'], ['B', 'Bookmark this page'], [',  Ctrl+,', 'Reading settings'], ['I', 'Book info'], ['Esc', 'Close panels']]],
  ['Reading', [['+  −  0', 'Bigger / smaller / reset text'], ['C', 'Switch day / night colors'], ['R', 'Cycle reading ruler'], ['X', 'Fixation emphasis'], ['V', 'Read aloud'], ['Z', 'Focus mode'], ['F', 'Full screen'], ['M', 'Show/hide bars'], ['Alt+1…9', 'Apply a text style'], ['Alt+Shift+1…9', 'Apply a color preset']]],
  ['App', [['Ctrl+O', 'Import books'], ['Ctrl+L', 'Library'], ['Ctrl+Shift+S', 'Reading stats'], ['Ctrl+E', 'Export highlights'], ['?', 'This list']]],
];

function shortcutsHelp() {
  modal({
    title: 'Keyboard shortcuts', wide: true,
    body: el('div.shortcuts', SHORTCUTS.map(([group, rows]) => el('div',
      el('h3', group),
      el('dl', rows.map(([k, d]) => [el('dt', k.split('  ').map((x) => el('kbd', x))), el('dd', d)]))))),
  });
}

function handleShortcut(e) {
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
    if (e.key === 'Escape') t.blur();
    return false;
  }
  const k = e.key;
  if (document.querySelector('.modal-backdrop')) {
    if (k === 'Escape') return closeTopModal();
    return false;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (k === 'Escape') {
    if (!$('#sel-popup').hidden) { annotations.hidePopup(); return true; }
    if (panel.isOpen()) { panel.close(); return true; }
    if (sidebar.isOpen()) { sidebar.close(); return true; }
    if (document.body.classList.contains('focus-mode')) { document.body.classList.remove('focus-mode'); return true; }
    if (document.body.classList.contains('fullscreen')) { window.api.window.fullscreen(false); return true; }
    return false;
  }
  if (k === '?' ) { shortcutsHelp(); return true; }
  if (document.body.dataset.view === 'library') {
    if (k === '/') { $('#library-view input[type=search]')?.focus(); return true; }
    return false;
  }
  if (!R.open) return false;
  if (mod && k.toLowerCase() === 'f') { sidebar.open('search'); return true; }
  if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
    // Alt+1…9 text styles, Alt+Shift+1…9 color presets
    const group = e.shiftKey ? 'colors' : 'text';
    const p = allPresets(group, getSettings())[+e.code.slice(5) - 1];
    if (p) { setSettings(presetPatch(group, p)); toast(p.name); }
    return true;
  }
  if (mod || e.altKey) return false;
  const s = getSettings();
  switch (k) {
    case 't': case 'T': sidebar.toggle('toc'); return true;
    case 'n': case 'N': sidebar.toggle('notes'); return true;
    case '/': sidebar.open('search'); return true;
    case 'b': case 'B': annotations.toggleBookmark(); return true;
    case ',': panel.toggle(); return true;
    case 'i': case 'I': modal({ title: R.meta.title, body: reader.bookInfo(), actions: [{ label: 'Close' }] }); return true;
    case 'f': case 'F': window.api.window.fullscreen(); return true;
    case 'z': case 'Z': toggleFocusMode(); return true;
    case 'm': case 'M': reader.toggleChrome(); return true;
    case 'p': case 'P': toast(turner.toggleAuto() ? (s.flow === 'paginated' ? `Auto-turn every ${s.autoTurnSeconds}s` : `Auto-scroll at ${s.autoScrollSpeed}px/s`) : 'Auto stopped'); return true;
    case '[': turner.nudgeAutoSpeed(-1); toast(s.flow === 'paginated' ? `Every ${getSettings().autoTurnSeconds}s` : `${getSettings().autoScrollSpeed}px/s`); return true;
    case ']': turner.nudgeAutoSpeed(1); toast(s.flow === 'paginated' ? `Every ${getSettings().autoTurnSeconds}s` : `${getSettings().autoScrollSpeed}px/s`); return true;
    case 'g': case 'G': goToDialog(); return true;
    case 'c': case 'C': themeFlip(); return true;
    case 'v': case 'V': tts.toggle(); return true;
    case 'x': case 'X': setSettings({ fixation: !s.fixation }); toast(s.fixation ? 'Fixation emphasis off' : 'Fixation emphasis on'); return true;
    case 'r': case 'R': {
      const order = ['off', 'line', 'band', 'spotlight'];
      const nextRuler = order[(order.indexOf(s.ruler) + 1) % order.length];
      setSettings({ ruler: nextRuler });
      toast(`Ruler: ${nextRuler}`);
      return true;
    }
    case '+': case '=': setSettings({ fontSize: Math.min(48, s.fontSize + 1) }); toast(`${s.fontSize + 1}px`); return true;
    case '-': case '_': setSettings({ fontSize: Math.max(10, s.fontSize - 1) }); toast(`${s.fontSize - 1}px`); return true;
    case '0': setSettings({ fontSize: 19 }); toast('19px'); return true;
    default: return turner.handleKey(e);
  }
}

window.addEventListener('keydown', (e) => {
  if (handleShortcut(e)) e.preventDefault();
});

// Keys pressed while the book page has focus arrive here too.
reader.onContents((contents) => {
  contents.document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (handleShortcut(e)) e.preventDefault();
  }, true);
});

boot().catch((e) => {
  console.error(e);
  document.body.append(el('pre.fatal', String(e?.stack || e)));
});
