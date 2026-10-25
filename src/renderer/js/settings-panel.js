// The reading settings drawer (Aa). Every control writes straight to the
// settings store, and the open book restyles live.
import { $, setChildren, el, icon, iconButton, toast, promptDialog, confirmDialog, debounce, syncRange } from './ui.js';
import { getSettings, setSettings, setBookScope, bookScopeActive, resetSettings, DEFAULTS } from './settings.js';
import { allThemes, isDark, HIGHLIGHT_COLORS, HIGHLIGHT_STYLES } from './themes.js';
import { listFonts, CATEGORIES, loadSystemFonts, systemFontsLoaded, setUserFonts, fontStack } from './fonts.js';
import { BUILTIN_TEMPLATES, snapshotTemplate, templatePatch } from './templates.js';
import { ANIMATIONS, ZONE_LAYOUTS, zoneAction } from './pageturn.js';
import { Curl } from './curl.js';
import { PAPERS, tileUrl } from './paper.js';
import { voices } from './tts.js';
import { R } from './reader.js';

let tab = 'text';
let fontQuery = '';

export function isOpen() { return document.body.classList.contains('settings-open'); }
export function open(which) { if (which) tab = which; document.body.classList.add('settings-open'); render(); }
export function close() { document.body.classList.remove('settings-open'); disposePreviews(); }
export function toggle(which) { if (isOpen() && (!which || which === tab)) close(); else open(which); }

const TABS = [
  ['text', 'Text', 'aa'],
  ['spacing', 'Spacing', 'ruler'],
  ['theme', 'Colors', 'sun'],
  ['page', 'Pages', 'layers'],
  ['controls', 'Turning', 'keyboard'],
  ['templates', 'Templates', 'star'],
  ['more', 'More', 'sparkle'],
];

export function render() {
  if (!isOpen()) return;
  disposePreviews();
  const root = $('#settings');
  const scroll = root.querySelector('.set-body')?.scrollTop || 0;
  const body = el('div.set-body', ({
    text: textTab, spacing: spacingTab, theme: themeTab, page: pageTab,
    controls: controlsTab, templates: templatesTab, more: moreTab,
  })[tab]());
  setChildren(root, 
    el('div.set-head',
      el('h2', 'Reading settings'),
      iconButton('x', 'Close', close)),
    R.open ? el('div.scope',
      el('span', 'Applies to'),
      el('div.seg',
        el('button', { class: !bookScopeActive() ? 'on' : '', onclick: () => { setBookScope(false); render(); } }, 'All books'),
        el('button', { class: bookScopeActive() ? 'on' : '', onclick: () => { setBookScope(true); render(); } }, 'This book'))) : null,
    el('div.set-tabs', TABS.map(([id, label, ic]) =>
      el('button.set-tab', { class: `set-tab ${tab === id ? 'on' : ''}`, title: label, onclick: () => { tab = id; render(); } }, icon(ic, 17), el('span', label)))),
    body);
  body.scrollTop = scroll;
}

// ---------- control builders ----------
function range(key, label, min, max, step, fmt = (v) => v, hint) {
  const s = getSettings();
  const out = el('output', fmt(s[key]));
  const input = el('input', {
    type: 'range', min, max, step, value: s[key],
    oninput: (e) => { const v = +e.target.value; out.textContent = fmt(v); setSettings({ [key]: v }); },
  });
  const nudge = (d) => { const v = Math.round((Math.min(max, Math.max(min, +input.value + d * step))) * 1000) / 1000; input.value = v; syncRange(input); out.textContent = fmt(v); setSettings({ [key]: v }); };
  return el('div.ctl',
    el('div.ctl-top', el('label', label), el('div.ctl-val',
      el('button.step', { title: 'Less', onclick: () => nudge(-1) }, '−'), out,
      el('button.step', { title: 'More', onclick: () => nudge(1) }, '+'))),
    input, hint ? el('p.hint', hint) : null);
}

function select(key, label, options, hint) {
  const s = getSettings();
  return el('div.ctl',
    el('label', label),
    el('select.input', { onchange: (e) => { setSettings({ [key]: coerce(e.target.value, s[key]) }); render(); } },
      options.map(([v, l]) => el('option', { value: v, selected: String(s[key]) === String(v) }, l))),
    hint ? el('p.hint', hint) : null);
}

function seg(key, label, options) {
  const s = getSettings();
  return el('div.ctl',
    el('label', label),
    el('div.seg', options.map(([v, l, ic]) => el('button', {
      class: String(s[key]) === String(v) ? 'on' : '', title: l,
      onclick: () => { setSettings({ [key]: coerce(v, s[key]) }); render(); },
    }, ic ? icon(ic, 15) : null, ic && !l ? null : l))));
}

function toggleCtl(key, label, hint) {
  const s = getSettings();
  return el('label.ctl.toggle',
    el('span', el('span.t-label', label), hint ? el('span.hint', hint) : null),
    el('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => { setSettings({ [key]: e.target.checked }); render(); } }),
    el('span.switch'));
}

const coerce = (v, like) => (typeof like === 'number' ? +v : typeof like === 'boolean' ? v === 'true' || v === true : v);
const px = (v) => `${v}px`;
const em = (v) => `${(+v).toFixed(2)}em`;
const pct = (v) => `${v}%`;

function section(title, ...kids) { return el('section.set-sec', el('h3', title), kids); }

// ---------- tabs ----------
function textTab() {
  const s = getSettings();
  return [
    section('Font', fontPicker()),
    section('Size & weight',
      range('fontSize', 'Font size', 10, 48, 1, px),
      range('fontWeight', 'Weight', 300, 700, 50, (v) => v),
      range('boldWeight', 'Bold weight', 500, 900, 100, (v) => v),
      range('textShadow', 'Thicken strokes', 0, 0.8, 0.05, (v) => (v ? `${v}px` : 'Off'), 'Adds weight to thin fonts, nice on dark themes.')),
    section('Headings',
      select('headingFont', 'Heading font', [['same', 'Same as body'], ['publisher', 'Publisher’s choice'],
        ...listFonts().filter((f) => f.category !== 'system').map((f) => [f.name, f.name])]),
      range('headingScale', 'Heading size', 0.6, 1.6, 0.05, (v) => `${Math.round(v * 100)}%`),
      toggleCtl('smallCapsHeadings', 'Small caps headings'),
      toggleCtl('dropCaps', 'Drop caps', 'A large initial letter at the start of chapters.')),
    section('Details',
      select('publisherStyles', 'Publisher styles', [['respect', 'Respect — only change colours and size'], ['mix', 'Mix — my fonts and spacing for body text'], ['override', 'Override — force my settings everywhere']]),
      toggleCtl('ligatures', 'Ligatures (fi, fl)'),
      toggleCtl('oldStyleNumbers', 'Old-style numerals'),
      select('fontSmoothing', 'Font smoothing (macOS)', [['auto', 'System default'], ['antialiased', 'Thinner (antialiased)'], ['subpixel', 'Subpixel']])),
    el('p.hint.center', `Previewing: ${s.font === 'publisher' ? 'publisher fonts' : s.font}`),
  ];
}

function fontPicker() {
  const s = getSettings();
  const list = el('div.font-list');
  const paint = () => {
    const q = fontQuery.toLowerCase();
    const fonts = [{ name: 'publisher', label: 'Publisher default', category: 'serif', blurb: 'Use the fonts the book came with' }, ...listFonts()]
      .filter((f) => !q || (f.label || f.name).toLowerCase().includes(q) || (f.blurb || '').toLowerCase().includes(q));
    const groups = new Map();
    for (const f of fonts) { const c = f.name === 'publisher' ? '' : f.category; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(f); }
    setChildren(list, ...[...groups.entries()].flatMap(([cat, fs]) => [
      cat ? el('div.font-cat', CATEGORIES[cat] || cat) : null,
      ...fs.map((f) => el('button.font-row', {
        class: `font-row ${s.font === f.name ? 'on' : ''}`,
        onclick: () => { setSettings({ font: f.name }); s.font = f.name; paint(); },
      },
      el('span.font-name', { style: { fontFamily: f.name === 'publisher' ? 'inherit' : fontStack(f.name) } }, f.label || f.name),
      f.blurb ? el('span.font-blurb', f.blurb) : null,
      f.source === 'user' ? el('span.font-x', { title: 'Remove font', onclick: async (e) => { e.stopPropagation(); setUserFonts(await window.api.fonts.remove(f.id)); paint(); } }, icon('x', 13)) : null)),
    ]));
  };
  paint();
  return el('div',
    el('input.input.small', { placeholder: `Search ${listFonts().length} fonts…`, value: fontQuery, type: 'search', oninput: debounce((e) => { fontQuery = e.target.value; paint(); }, 100) }),
    list,
    el('div.row-btns',
      el('button.btn.small', { onclick: async () => { setUserFonts(await window.api.fonts.import()); render(); } }, icon('plus', 14), 'Add font files'),
      el('button.btn.small', {
        disabled: systemFontsLoaded(),
        onclick: async () => { const f = await loadSystemFonts(); toast(f.length ? `Found ${f.length} installed fonts` : 'Could not read installed fonts'); render(); },
      }, icon('search', 14), systemFontsLoaded() ? 'Installed fonts listed' : 'Show installed fonts')));
}

function spacingTab() {
  return [
    section('Lines & letters',
      range('lineHeight', 'Line spacing', 1, 3, 0.05, (v) => (+v).toFixed(2)),
      range('letterSpacing', 'Letter spacing', -0.05, 0.25, 0.005, em),
      range('wordSpacing', 'Word spacing', -0.1, 0.6, 0.01, em)),
    section('Paragraphs',
      range('paragraphSpacing', 'Space between paragraphs', 0, 3, 0.05, em),
      range('paragraphIndent', 'First-line indent', 0, 5, 0.1, em),
      seg('textAlign', 'Alignment', [['publisher', 'Book'], ['left', 'Left'], ['justify', 'Justify'], ['center', 'Center']]),
      seg('wordBreaks', 'Split words across lines', [['auto', 'Automatically'], ['book', 'Where the book allows'], ['never', 'Never']]),
      el('p.hint', { style: { marginTop: '-10px', marginBottom: '16px' } }, getSettings().wordBreaks === 'never'
        ? 'Words always stay whole on one line. Justified text may space out more.'
        : getSettings().wordBreaks === 'book' ? 'Only at the break points the book itself marks.' : 'Hyphenates long words (6+ letters) for smoother lines.')),
    section('Margins & width',
      range('marginH', 'Side margins', 0, 240, 4, px, 'Shrinks automatically on narrow windows.'),
      range('marginV', 'Top & bottom margins', 0, 160, 4, px),
      range('lineLength', 'Line length', 40, 130, 1, (v) => (v >= 130 ? 'No limit' : `${v} characters`), 'About 60–75 characters is easiest to read. Scales with the font size.'),
      range('columnGap', 'Gap between pages', 0, 160, 4, px)),
    section('Reset', el('button.btn.small', {
      onclick: () => { resetSettings(['lineHeight', 'letterSpacing', 'wordSpacing', 'paragraphSpacing', 'paragraphIndent', 'textAlign', 'wordBreaks', 'marginH', 'marginV', 'lineLength', 'columnGap']); render(); },
    }, 'Reset spacing to defaults')),
  ];
}

function themeTab() {
  const s = getSettings();
  const themes = allThemes(s);
  const light = themes.filter((t) => !isDark(t)), dark = themes.filter((t) => isDark(t));
  const card = (t) => el('button.theme-card', {
    class: `theme-card ${s.theme === t.id ? 'on' : ''}`,
    style: { background: t.bg, color: t.fg, '--tl': t.link },
    title: t.name,
    onclick: () => { setSettings({ theme: t.id }); render(); },
  }, el('span.theme-aa', 'Aa'), el('span.theme-name', t.name),
  t.custom ? el('span.theme-x', { title: 'Delete theme', onclick: (e) => { e.stopPropagation(); setSettings({ customThemes: s.customThemes.filter((x) => x.id !== t.id), theme: s.theme === t.id ? 'paper' : s.theme }); render(); } }, icon('x', 12)) : null);
  return [
    section('Light', el('div.theme-grid', light.map(card))),
    section('Dark', el('div.theme-grid', dark.map(card))),
    section('Make your own', customThemeEditor()),
    section('Paper', paperPicker()),
    section('Atmosphere',
      range('brightness', 'Brightness', 30, 100, 1, pct, 'Dims the page beyond your screen’s minimum.'),
      range('warmth', 'Warmth (night light)', 0, 100, 1, pct),
      range('vignette', 'Vignette', 0, 100, 1, pct),
      toggleCtl('keepPublisherColors', 'Keep the book’s own text colours'),
      select('autoDarkTheme', 'When the system is in dark mode use', [['', 'Same theme (off)'], ...dark.map((t) => [t.id, t.name])])),
    section('Images',
      range('dimImages', 'Dim images', 0, 60, 1, pct),
      toggleCtl('invertImagesInDark', 'Invert images on dark themes', 'Good for black-on-white diagrams.'),
      seg('imageFit', 'Image size', [['contain', 'Fit page'], ['width', 'Full width'], ['original', 'Original']])),
  ];
}

function customThemeEditor() {
  const s = getSettings();
  const base = allThemes(s).find((t) => t.id === s.theme) || allThemes(s)[0];
  const draft = { bg: base.bg, fg: base.fg, link: base.link, accent: base.accent || base.link };
  const preview = el('div.theme-preview', el('strong', 'The quick brown fox'), ' jumps over the ', el('a', 'lazy dog'), '.');
  const paint = () => { Object.assign(preview.style, { background: draft.bg, color: draft.fg }); preview.querySelector('a').style.color = draft.link; };
  paint();
  const picker = (k, label) => el('label.color-field', el('input', { type: 'color', value: draft[k], oninput: (e) => { draft[k] = e.target.value; paint(); } }), label);
  return el('div',
    preview,
    el('div.color-fields', picker('bg', 'Page'), picker('fg', 'Text'), picker('link', 'Links'), picker('accent', 'Accent')),
    el('button.btn.small', {
      onclick: async () => {
        const name = await promptDialog('Save colour scheme', 'Name', 'My theme');
        if (!name) return;
        const t = { id: `custom-${Date.now().toString(36)}`, name, ...draft };
        setSettings({ customThemes: [...s.customThemes, t], theme: t.id }, { scope: 'global' });
        setSettings({ theme: t.id });
        render();
      },
    }, icon('plus', 14), 'Save as new theme'));
}

function pageTab() {
  const s = getSettings();
  return [
    section('Layout',
      seg('flow', 'Reading mode', [['paginated', 'Pages', 'layers'], ['scrolled', 'Scroll chapter', 'scroll'], ['continuous', 'Endless scroll', 'rows']]),
      s.flow === 'paginated' ? seg('spread', 'Pages side by side', [['auto', 'Auto'], ['none', 'One page'], ['always', 'Two pages']]) : null,
      s.flow === 'paginated' && s.spread === 'auto' ? el('p.hint', 'Auto shows two pages when the window is wide enough for each to hold a full line.') : null,
      s.flow === 'paginated' && s.spread !== 'none' ? creaseCtls() : null),
    section('Page turn animation',
      el('div.anim-grid', ANIMATIONS.map((a) => animCard(a, s.pageAnimation === a.id))),
      el('div.row-btns', el('button.btn.small', { disabled: !R.open || s.flow !== 'paginated', onclick: tryAnimation }, icon('play', 13), 'Try it on this page')),
      range('animationMs', 'Animation speed', 100, 900, 20, (v) => (v < 200 ? 'Quick' : v < 400 ? 'Normal' : v < 650 ? 'Relaxed' : 'Slow')),
      s.pageAnimation === 'curl' ? el('p.hint', 'With Page curl you can also drag the page: press in the margin beside the text and pull toward the spine.') : null,
      s.flow !== 'paginated' ? el('p.hint', 'Animations apply in Pages mode.') : null),
    section('Header & footer',
      toggleCtl('showHeader', 'Show top bar'),
      s.showHeader ? toggleCtl('solidHeader', 'Solid top bar', 'A bar the pages tuck under. Off, the page runs to the top of the window.') : null,
      toggleCtl('showFooter', 'Show footer'),
      toggleCtl('hideChromeWhileReading', 'Hide bars while reading', 'Move the mouse to the top or bottom edge, or click the middle, to bring them back.'),
      toggleCtl('showScrubber', 'Progress scrubber in footer'),
      select('footerLeft', 'Footer left', [['chapter', 'Chapter title'], ['title', 'Book title'], ['clock', 'Clock'], ['none', 'Nothing']]),
      select('footerCenter', 'Footer middle', [['page', 'Page in chapter'], ['chapter-left', 'Time left in chapter'], ['book-left', 'Time left in book'], ['percent', 'Percent'], ['none', 'Nothing']]),
      select('footerRight', 'Footer right', [['percent', 'Percent'], ['book-left', 'Time left in book'], ['chapter-left', 'Time left in chapter'], ['clock', 'Clock'], ['page', 'Page in chapter'], ['none', 'Nothing']])),
  ];
}

// ---------- animation previews ----------
// Each preview shows a little two-page spread turning exactly the way the
// real animation does. Sheet animations are CSS; curl and flip run the same
// WebGL page as the reader, on a tiny canvas.
function miniSpread(cls) {
  return el(`span.pv-spread.${cls}`, el('span.pv-pg'), el('span.pv-pg'));
}
// the new spread starts a chapter, so the change is easy to see
const newSpread = () => el('span.pv-spread.pv-new', el('span.pv-pg.pv-heading'), el('span.pv-pg'));

function animCard(a, on) {
  const pv = el('span.pv', { dataset: { kind: a.id } }, newSpread(), LEAF.has(a.id) ? null : miniSpread('pv-old'));
  const card = el('button.anim-card', {
    class: `anim-card ${on ? 'on' : ''}`,
    title: a.blurb,
    onclick: () => { setSettings({ pageAnimation: a.id }); render(); },
    onmouseenter: () => startLeafPreview(pv, a.id),
    onmouseleave: () => stopLeafPreview(pv),
  }, pv, el('span.anim-name', a.name), el('span.anim-blurb', a.blurb));
  // previews only move while hovered, so an open panel costs nothing
  if (LEAF.has(a.id)) requestAnimationFrame(() => drawLeafPreview(pv, a.id, 0.32));
  return card;
}

const LEAF = new Set(['curl', 'flip']);
const previews = new WeakMap();
const previewEngines = new Set();

// WebGL contexts are limited; free the old previews' whenever the panel redraws.
function disposePreviews() {
  for (const e of previewEngines) e.destroy();
  previewEngines.clear();
}

function previewImage(w, h) {
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue('--bg').trim() || '#fff';
  const fg = cs.getPropertyValue('--fg').trim() || '#222';
  const c = document.createElement('canvas');
  const k = 2;
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d');
  g.scale(k, k);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const page = (x0, x1, heading) => {
    g.fillStyle = fg;
    let y = h * 0.16;
    if (heading) { g.globalAlpha = 0.7; g.fillRect(x0 + (x1 - x0) * 0.25, y, (x1 - x0) * 0.5, 2.2); y += 7; }
    g.globalAlpha = 0.32;
    for (let i = 0; y < h * 0.86; i++, y += 3.4) g.fillRect(x0, y, (x1 - x0) * (i % 6 === 5 ? 0.6 : 1), 1.3);
    g.globalAlpha = 1;
  };
  page(w * 0.08, w * 0.44, false);
  page(w * 0.56, w * 0.92, false);
  return c;
}

function drawLeafPreview(pv, kind, t) {
  let st = previews.get(pv);
  if (!st) {
    const W = pv.clientWidth, H = pv.clientHeight;
    if (!W || !H) return;
    const engine = new Curl(pv, { grid: [24, 16] });
    if (!engine.ok) return;
    const image = previewImage(W, H);
    const cs = getComputedStyle(document.documentElement);
    engine.begin({ image, W, H, cap: { x: 0, y: 0, w: W, h: H }, hinge: W / 2, side: 1, leaf: { w: W / 2, top: 0, h: H }, stat: [0, W / 2], paper: cs.getPropertyValue('--bg').trim(), persp: 0.004 });
    engine.show(true);
    previewEngines.add(engine);
    st = { engine, raf: 0 };
    previews.set(pv, st);
  }
  const rigid = kind === 'flip';
  st.engine.draw(t, rigid ? 0 : 0.26, { backAlpha: 1 - Math.min(1, Math.max(0, (t - 0.9) / 0.1)), rigid });
}

function startLeafPreview(pv, kind) {
  if (!LEAF.has(kind)) return;
  drawLeafPreview(pv, kind, 0);
  const st = previews.get(pv);
  if (!st || st.raf) return;
  const start = performance.now();
  const cycle = 2600;
  const tick = (now) => {
    if (!pv.isConnected) { st.raf = 0; return; }
    const x = ((now - start) % cycle) / cycle;
    const k = Math.min(1, Math.max(0, (x - 0.15) / 0.55));
    const t = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    drawLeafPreview(pv, kind, t);
    st.raf = requestAnimationFrame(tick);
  };
  st.raf = requestAnimationFrame(tick);
}

function stopLeafPreview(pv) {
  const st = previews.get(pv);
  if (!st) return;
  cancelAnimationFrame(st.raf);
  st.raf = 0;
  drawLeafPreview(pv, pv.dataset.kind, 0.32);
}

async function tryAnimation() {
  const { turn } = await import('./pageturn.js');
  close();
  await new Promise((r) => setTimeout(r, 350));
  await turn(1);
  await new Promise((r) => setTimeout(r, 500));
  await turn(-1);
}

// ---------- paper ----------
function paperPicker() {
  const s = getSettings();
  const theme = allThemes(s).find((t) => t.id === s.theme) || allThemes(s)[0];
  const dark = isDark(theme);
  const card = (p) => {
    const url = p.id === 'custom' ? (s.paperImage ? `app://reader/usertextures/${encodeURIComponent(s.paperImage)}` : null)
      : p.id === 'smooth' ? null : tileUrl(p.id, dark);
    return el('button.paper-card', {
      class: `paper-card ${s.paperType === p.id ? 'on' : ''}`,
      title: p.name,
      style: { background: theme.bg, color: theme.fg },
      onclick: async () => {
        if (p.id === 'custom' && !s.paperImage) {
          const name = await window.api.textures.import();
          if (!name) return;
          setSettings({ paperImage: name, paperType: 'custom', paperTexture: Math.max(s.paperTexture, 50) });
        } else {
          setSettings({ paperType: p.id, paperTexture: p.id === 'smooth' ? s.paperTexture : Math.max(s.paperTexture, 15) });
        }
        render();
      },
    },
    el('span.paper-swatch', { style: url ? { backgroundImage: `url("${url}")`, backgroundSize: p.id === 'custom' ? 'cover' : '128px' } : {} }, p.id === 'custom' && !url ? icon('plus', 16) : null),
    el('span.paper-name', p.name));
  };
  return [
    el('div.paper-grid', PAPERS.map(card)),
    s.paperType !== 'smooth' ? range('paperTexture', 'Strength', 0, 100, 1, pct) : null,
    s.paperType !== 'smooth' ? range('paperScale', 'Scale', 0.5, 3, 0.05, (v) => `${Math.round(v * 100)}%`) : null,
    s.paperType === 'custom' ? el('div.row-btns', el('button.btn.small', {
      onclick: async () => { const name = await window.api.textures.import(); if (name) { setSettings({ paperImage: name, paperType: 'custom' }); render(); } },
    }, icon('upload', 13), 'Choose another image')) : null,
    creaseCtls(),
  ];
}

function creaseCtls() {
  const s = getSettings();
  return [
    toggleCtl('spineShadow', 'Crease between pages', 'A fold down the middle of two-page spreads, like an open book.'),
    s.spineShadow ? range('creaseDepth', 'Crease depth', 5, 100, 1, (v) => (v < 25 ? 'Faint' : v < 50 ? 'Soft' : v < 75 ? 'Deep' : 'Very deep')) : null,
  ];
}

function controlsTab() {
  const s = getSettings();
  return [
    section('Click & tap zones',
      zoneDiagram(s.clickZones, s.invertZones),
      select('clickZones', 'Layout', ZONE_LAYOUTS.map((z) => [z.id, z.name])),
      toggleCtl('invertZones', 'Swap back and forward zones', 'For left-handed one-hand reading.'),
      toggleCtl('doubleTapFullscreen', 'Double-click for full screen')),
    section('Keyboard & remotes',
      toggleCtl('keyArrows', 'Arrow keys', '← → turn pages; ↑ ↓ move the reading ruler when it is on.'),
      toggleCtl('keySpace', 'Space bar', 'Shift+Space goes back.'),
      toggleCtl('keyPage', 'Page Up / Page Down', 'Most Bluetooth page-turner pedals and presentation clickers send these.'),
      toggleCtl('keyVim', 'Vim keys (h j k l)'),
      toggleCtl('keyWasd', 'Gamer keys (W A S D)'),
      toggleCtl('keyMedia', 'Media & volume keys', 'Phone-style clickers often send volume up/down.'),
      toggleCtl('gamepad', 'Game controllers', 'Bumpers, triggers, D-pad, A/B and the left stick turn pages; Start shows the menu.')),
    section('Mouse & trackpad',
      toggleCtl('wheelTurns', 'Mouse wheel turns pages'),
      toggleCtl('wheelInvert', 'Reverse wheel direction'),
      toggleCtl('swipeTurns', 'Two-finger swipe & touch swipe')),
    section('Hands-free',
      range('autoTurnSeconds', 'Auto-turn every', 3, 300, 1, (v) => `${v} s`, 'Pages mode. Start it with the timer button or P.'),
      range('autoScrollSpeed', 'Auto-scroll speed', 5, 400, 5, (v) => `${v} px/s`, 'Scroll modes. [ and ] change speed while running.'),
      toggleCtl('autoPauseOnInteract', 'Pause auto-scroll when I turn a page myself')),
  ];
}

function zoneDiagram(layout, invert) {
  const grid = el('div.zone-diagram');
  const cols = 24, rows = 16;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let a = zoneAction(layout, (c + 0.5) / cols, (r + 0.5) / rows);
      if (invert && (a === 'next' || a === 'prev')) a = a === 'next' ? 'prev' : 'next';
      grid.append(el('i', { class: `z-${a}` }));
    }
  }
  return el('div.zone-wrap', grid, el('div.zone-legend', el('span.z-prev', 'Back'), el('span.z-menu', 'Menu'), el('span.z-next', 'Forward')));
}

function templatesTab() {
  const s = getSettings();
  const apply = (t) => { setSettings(templatePatch(t)); toast(`Applied “${t.name}”`); render(); };
  const card = (t) => {
    const th = allThemes(s).find((x) => x.id === t.settings.theme) || allThemes(s)[0];
    return el('div.tpl-card', { onclick: () => apply(t) },
      el('div.tpl-preview', { style: { background: th.bg, color: th.fg, fontFamily: fontStack(t.settings.font) || 'serif', lineHeight: t.settings.lineHeight || 1.5, textAlign: t.settings.textAlign === 'justify' ? 'justify' : 'left' } },
        el('b', t.name), el('span', ' — The lamp threw a soft circle of light across the open page.')),
      el('div.tpl-meta', el('span', t.blurb),
        t.user ? el('button.link-btn.danger', { onclick: async (e) => { e.stopPropagation(); if (await confirmDialog('Delete template?', t.name, 'Delete', true)) { setSettings({ userTemplates: s.userTemplates.filter((x) => x.id !== t.id) }, { scope: 'global' }); render(); } } }, 'Delete') : null));
  };
  return [
    section('Your templates',
      el('button.btn.small', {
        onclick: async () => {
          const name = await promptDialog('Save current look as a template', 'Name', 'My reading setup');
          if (!name) return;
          setSettings({ userTemplates: [...s.userTemplates, snapshotTemplate(getSettings(), name)] }, { scope: 'global' });
          render();
        },
      }, icon('plus', 14), 'Save current settings as template'),
      s.userTemplates.length ? el('div.tpl-grid', s.userTemplates.map(card)) : el('p.hint', 'Templates capture fonts, spacing, colours, layout and page turning.')),
    section('Built in', el('div.tpl-grid', BUILTIN_TEMPLATES.map(card))),
  ];
}

function moreTab() {
  const s = getSettings();
  const vs = voices();
  return [
    section('Reading ruler',
      seg('ruler', 'Ruler', [['off', 'Off'], ['line', 'Line'], ['band', 'Band'], ['spotlight', 'Spotlight']]),
      s.ruler !== 'off' ? range('rulerLines', 'Ruler height', 1, 8, 1, (v) => `${v} line${v > 1 ? 's' : ''}`) : null,
      s.ruler !== 'off' ? range('rulerOpacity', 'Ruler strength', 5, 90, 1, pct) : null),
    section('Fixation emphasis',
      toggleCtl('fixation', 'Emphasise word beginnings', 'Bionic-style: the end of each word is dimmed so your eyes land on its start.'),
      s.fixation ? range('fixationStrength', 'Strength', 0, 100, 1, pct) : null),
    section('Highlights',
      el('div.ctl', el('label', 'Default colour'), el('div.pop-colors', HIGHLIGHT_COLORS.map((c) => el('button.swatch', {
        class: `swatch ${s.highlightColor === c.id ? 'on' : ''}`, style: { '--c': c.hex }, title: c.name,
        onclick: () => { setSettings({ highlightColor: c.id }, { scope: 'global' }); render(); },
      })))),
      select('highlightStyle', 'Default style', HIGHLIGHT_STYLES.map((x) => [x.id, x.name])),
      range('highlightOpacity', 'Highlight strength', 10, 90, 1, pct),
      toggleCtl('quickHighlight', 'Highlight as soon as I select', 'Hold Alt (Option) while selecting to skip it.')),
    section('Read aloud',
      el('div.ctl', el('label', 'Voice'), el('select.input', { onchange: (e) => setSettings({ ttsVoice: e.target.value }) },
        el('option', { value: '' }, 'System default'),
        vs.map((v) => el('option', { value: v.name, selected: s.ttsVoice === v.name }, `${v.name} (${v.lang})`)))),
      range('ttsRate', 'Speed', 0.5, 3, 0.05, (v) => `${(+v).toFixed(2)}×`),
      range('ttsPitch', 'Pitch', 0.5, 1.5, 0.05, (v) => (+v).toFixed(2))),
    graphicsSection(),
    section('Pace',
      range('defaultWpm', 'Starting reading speed', 100, 600, 10, (v) => `${v} wpm`, 'Used for time-left estimates until Margins has measured your own pace.')),
    section('Reset',
      el('button.btn.small.danger', {
        onclick: async () => {
          if (!(await confirmDialog('Reset all reading settings?', 'Your custom themes and templates are kept.', 'Reset', true))) return;
          resetSettings(Object.keys(DEFAULTS).filter((k) => !['customThemes', 'userTemplates', 'customHighlightColors'].includes(k)));
          render();
        },
      }, 'Reset everything to defaults')),
  ];
}

// Graphics options only take effect after a restart (Chromium reads them at
// launch), so the panel shows what is saved and offers to restart.
let gfx = null;
let gfxStartup = null;
window.api.graphics.get().then((g) => { gfx = g; gfxStartup = { ...g }; });

function graphicsSection() {
  if (!gfx) return null;
  const changed = gfx.hardwareAcceleration !== gfxStartup.hardwareAcceleration || gfx.srgb !== gfxStartup.srgb;
  const sw = (key, label, hint) => el('label.ctl.toggle',
    el('span', el('span.t-label', label), el('span.hint', hint)),
    el('input', { type: 'checkbox', checked: !!gfx[key], onchange: async (e) => { gfx = await window.api.graphics.set({ [key]: e.target.checked }); render(); } }),
    el('span.switch'));
  return section('Display',
    sw('hardwareAcceleration', 'Hardware acceleration', 'Smoother animations when on. Off by default on Windows, where some GPUs (notably NVIDIA with HDR) flicker with it.'),
    sw('srgb', 'Standard colours (sRGB)', 'Keeps colours steady with Windows HDR or NVIDIA auto-HDR on. Recommended.'),
    changed ? el('button.btn.small.primary', { onclick: () => window.api.relaunch() }, 'Restart Margins to apply') : null);
}

document.addEventListener('voices-changed', () => { if (tab === 'more') render(); });
