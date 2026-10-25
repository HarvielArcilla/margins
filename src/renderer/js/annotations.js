// Highlights, notes and bookmarks: storage, drawing them into the book with
// the CSS Custom Highlight API, the selection toolbar, and export.
import { $, setChildren, el, icon, iconButton, toast, uid, promptDialog, escapeHtml } from './ui.js';
import { getSettings, setSettings } from './settings.js';
import { HIGHLIGHT_COLORS, HIGHLIGHT_STYLES, findTheme, isDark, rgba, mix } from './themes.js';
import { R, onContents, liveContents, currentChapter, percentage, visibleRange, goTo } from './reader.js';
import * as sidebar from './sidebar.js';
import * as tts from './tts.js';

let items = [];
let bookId = null;
function listeners() { return listeners.set || (listeners.set = new Set()); }

export function onChange(fn) { listeners().add(fn); }
const changed = () => { for (const fn of listeners()) fn(items); };

export async function load(id) {
  bookId = id;
  items = await window.api.annotations.get(id);
}
export function reset() { items = []; bookId = null; hidePopup(); }
export function all() { return items; }
export const highlights = () => items.filter((a) => a.type === 'highlight');
export const bookmarks = () => items.filter((a) => a.type === 'bookmark');

function save() {
  if (bookId) window.api.annotations.set(bookId, items);
  changed();
}

const spineOf = (cfi) => {
  try { return new window.ePub.CFI(cfi).spinePos; } catch { return -1; }
};
const cfiCompare = (a, b) => new window.ePub.CFI().compare(a, b);

export function sortByPosition(list) {
  return [...list].sort((a, b) => { try { return cfiCompare(a.cfi, b.cfi); } catch { return 0; } });
}

export function colorHex(id) {
  return HIGHLIGHT_COLORS.find((c) => c.id === id)?.hex
    || getSettings().customHighlightColors.find((c) => c.id === id)?.hex
    || (/^#[0-9a-f]{6}$/i.test(id) ? id : '#f6d23f');
}

export function allColors() {
  return [...HIGHLIGHT_COLORS, ...getSettings().customHighlightColors];
}

// ---------- create / edit ----------
export function addHighlight({ cfi, text, color, style, note = '' }) {
  const ch = currentChapter();
  const a = {
    id: uid(), type: 'highlight', cfi, text,
    color: color || getSettings().highlightColor,
    style: style || getSettings().highlightStyle,
    note, chapter: ch?.label || '', percent: percentage() ?? 0,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  items.push(a);
  save();
  renderAll();
  return a;
}

export function update(id, patch) {
  const a = items.find((x) => x.id === id);
  if (!a) return;
  Object.assign(a, patch, { updatedAt: Date.now() });
  save();
  renderAll();
}

export function remove(id) {
  items = items.filter((x) => x.id !== id);
  save();
  renderAll();
}

// ---------- bookmarks ----------
export function isBookmarked() {
  const loc = R.location;
  if (!loc) return false;
  return bookmarks().some((b) => inPage(b.cfi, loc));
}

function inPage(cfi, loc) {
  try { return cfiCompare(cfi, loc.start.cfi) >= 0 && cfiCompare(cfi, loc.end.cfi) <= 0; } catch { return false; }
}

export async function toggleBookmark() {
  const loc = R.location;
  if (!loc) return;
  const here = bookmarks().filter((b) => inPage(b.cfi, loc));
  if (here.length) {
    items = items.filter((x) => !here.includes(x));
    toast('Bookmark removed');
  } else {
    const vr = await visibleRange();
    const excerpt = vr ? vr.range.toString().replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    items.push({
      id: uid(), type: 'bookmark', cfi: loc.start.cfi, text: excerpt, chapter: currentChapter()?.label || '',
      percent: percentage() ?? 0, createdAt: Date.now(), updatedAt: Date.now(), note: '',
    });
    toast('Bookmarked');
  }
  save();
  $('#bm-btn')?.classList.toggle('active', isBookmarked());
}

export function locationChanged() {
  $('#bm-btn')?.classList.toggle('active', isBookmarked());
  hidePopup();
}

// ---------- drawing ----------
const keyFor = (a) => `m-a-${a.style}-${colorHex(a.color).slice(1)}`;

function ruleFor(key) {
  const [, , style, hex] = key.split('-');
  const s = getSettings();
  const theme = R.theme || findTheme(s);
  const dark = isDark(theme);
  const c = `#${hex}`;
  const alpha = (s.highlightOpacity / 100) * (dark ? 0.75 : 1);
  const bg = rgba(c, alpha);
  const line = dark ? mix(c, '#ffffff', 0.15) : mix(c, '#000000', 0.15);
  const deco = (kind) => `text-decoration: underline ${kind} ${line}; text-decoration-thickness: 2px; text-underline-offset: 3px;`;
  const body = {
    highlight: `background-color: ${bg};`,
    marker: `background-color: ${bg}; ${deco('solid')}`,
    underline: deco('solid'),
    wavy: `text-decoration: underline wavy ${line}; text-decoration-thickness: 1.5px; text-underline-offset: 3px;`,
    dotted: deco('dotted'),
    dashed: deco('dashed'),
    double: `text-decoration: underline double ${line}; text-underline-offset: 2px;`,
    strike: `text-decoration: line-through ${line}; text-decoration-thickness: 2px;`,
    text: `color: ${dark ? mix(c, '#ffffff', 0.2) : mix(c, '#000000', 0.35)};`,
    glow: `text-shadow: 0 0 6px ${rgba(c, 0.9)}, 0 0 1px ${rgba(c, 0.9)}; background-color: ${rgba(c, alpha * 0.35)};`,
  }[style] || `background-color: ${bg};`;
  return `::highlight(${key}) { ${body} }`;
}

function renderInContents(contents) {
  const win = contents.window, doc = contents.document;
  const reg = win?.CSS?.highlights;
  if (!reg) return;
  for (const k of [...reg.keys()]) if (k.startsWith('m-a-')) reg.delete(k);
  const groups = new Map();
  contents._annoRanges = [];
  for (const a of highlights()) {
    if (spineOf(a.cfi) !== contents.sectionIndex) continue;
    let range;
    try { range = contents.range(a.cfi); } catch { range = null; }
    if (!range || range.collapsed) continue;
    contents._annoRanges.push({ a, range });
    const k = keyFor(a);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(range);
  }
  let css = '';
  for (const [k, ranges] of groups) {
    const h = new win.Highlight(...ranges);
    h.priority = 2;
    reg.set(k, h);
    css += ruleFor(k) + '\n';
  }
  let tag = doc.getElementById('m-anno-style');
  if (!tag) { tag = doc.createElement('style'); tag.id = 'm-anno-style'; doc.head.append(tag); }
  if (tag.textContent !== css) tag.textContent = css;
}

export function renderAll() { for (const c of liveContents()) renderInContents(c); }
export function restyle() { renderAll(); }

onContents((c) => renderInContents(c));

// Temporary marks (search hits, the word being spoken, a flash after jumping).
export function mark(name, cfiOrRange, contents) {
  for (const c of liveContents()) c.window?.CSS?.highlights?.delete(name);
  if (!cfiOrRange) return;
  const targets = contents ? [contents] : liveContents();
  for (const c of targets) {
    let range = null;
    if (typeof cfiOrRange === 'string') {
      if (spineOf(cfiOrRange) !== c.sectionIndex) continue;
      try { range = c.range(cfiOrRange); } catch { continue; }
    } else if (cfiOrRange.startContainer?.ownerDocument === c.document) {
      range = cfiOrRange;
    }
    if (!range) continue;
    const h = new c.window.Highlight(range);
    h.priority = 5;
    c.window.CSS.highlights.set(name, h);
  }
}

export async function flash(cfi) {
  mark('m-flash', cfi);
  setTimeout(() => mark('m-flash', null), 1600);
}

// ---------- selection & clicking ----------
let current = null; // { cfi, text, contents } or { annotation }

export function onMouseUp(contents, e, pt) {
  const sel = contents.document.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const text = range.toString().trim();
  if (!text) return;
  let cfi;
  try { cfi = contents.cfiFromRange(range); } catch { return; }
  const s = getSettings();
  if (s.quickHighlight && !e.altKey) {
    const a = addHighlight({ cfi, text });
    sel.removeAllRanges();
    showPopup({ annotation: a, contents }, rectOf(contents, range) || pt);
    return;
  }
  current = { cfi, text, contents, range };
  showPopup(current, rectOf(contents, range) || pt);
}

export function onClick(contents, e, pt) {
  const hits = contents._annoRanges || [];
  if (!hits.length) return false;
  const doc = contents.document;
  const pos = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
  if (!pos) return false;
  const hit = [...hits].reverse().find(({ range }) => {
    try { return range.isPointInRange(pos.startContainer, pos.startOffset) && range.comparePoint(pos.startContainer, pos.startOffset) === 0; } catch { return false; }
  });
  if (!hit) return false;
  showPopup({ annotation: hit.a, contents }, rectOf(contents, hit.range) || pt);
  return true;
}

function rectOf(contents, range) {
  const frame = contents.document.defaultView.frameElement;
  const fr = frame.getBoundingClientRect();
  const rects = [...range.getClientRects()];
  if (!rects.length) return null;
  const first = rects[0], last = rects[rects.length - 1];
  return {
    top: fr.top + Math.min(first.top, last.top),
    bottom: fr.top + Math.max(first.bottom, last.bottom),
    x: fr.left + (first.left + last.right) / 2,
  };
}

export function hidePopup() {
  const p = $('#sel-popup');
  if (p) p.hidden = true;
  current = null;
}

function showPopup(ctx, at) {
  const p = $('#sel-popup');
  const existing = ctx.annotation;
  const s = getSettings();
  const selColor = existing ? existing.color : s.highlightColor;
  const selStyle = existing ? existing.style : s.highlightStyle;

  const apply = (patch) => {
    if (existing) { update(existing.id, patch); showPopup({ ...ctx, annotation: items.find((x) => x.id === existing.id) }, at); return; }
    const a = addHighlight({ cfi: ctx.cfi, text: ctx.text, ...patch });
    ctx.contents.document.getSelection()?.removeAllRanges();
    showPopup({ annotation: a, contents: ctx.contents }, at);
  };

  const colors = el('div.pop-colors', allColors().map((c) =>
    el('button.swatch', {
      title: c.name, style: { '--c': c.hex },
      class: `swatch ${existing && existing.color === c.id ? 'on' : ''}`,
      onclick: () => { setSettings({ highlightColor: c.id }, { scope: 'global' }); apply({ color: c.id, style: existing ? existing.style : selStyle }); },
    })),
  el('label.swatch.custom', { title: 'Custom colour' },
    el('input', {
      type: 'color', value: colorHex(selColor),
      onchange: (e) => {
        const hex = e.target.value;
        const custom = [...s.customHighlightColors];
        if (!allColors().some((c) => c.hex.toLowerCase() === hex.toLowerCase())) {
          custom.push({ id: hex, name: hex, hex });
          setSettings({ customHighlightColors: custom.slice(-8) }, { scope: 'global' });
        }
        apply({ color: hex });
      },
    })));

  const styles = el('div.pop-styles', HIGHLIGHT_STYLES.map((st) =>
    el('button.style-btn', {
      title: st.name,
      class: `style-btn st-${st.id} ${existing && existing.style === st.id ? 'on' : ''}`,
      style: { '--c': colorHex(selColor) },
      onclick: () => { setSettings({ highlightStyle: st.id }, { scope: 'global' }); apply({ style: st.id, color: existing ? existing.color : selColor }); },
    }, el('span', 'Ab'))));

  const text = existing ? existing.text : ctx.text;
  const actions = el('div.pop-actions',
    el('button.pop-act', {
      onclick: async () => {
        const note = await promptDialog(existing?.note ? 'Edit note' : 'Add note', `“${text.slice(0, 120)}${text.length > 120 ? '…' : ''}”`, existing?.note || '', { multiline: true, placeholder: 'Your thoughts…' });
        if (note == null) return;
        if (existing) update(existing.id, { note });
        else addHighlight({ cfi: ctx.cfi, text: ctx.text, note });
        hidePopup();
      },
    }, icon('note', 16), existing?.note ? 'Edit note' : 'Note'),
    el('button.pop-act', { onclick: () => { navigator.clipboard.writeText(text); toast('Copied'); hidePopup(); } }, icon('copy', 16), 'Copy'),
    el('button.pop-act', {
      onclick: () => {
        const cite = `“${text}”\n— ${R.meta.author ? `${R.meta.author}, ` : ''}${R.meta.title}${currentChapter()?.label ? `, ${currentChapter().label}` : ''}`;
        navigator.clipboard.writeText(cite); toast('Copied with citation'); hidePopup();
      },
    }, icon('library', 16), 'Cite'),
    el('button.pop-act', { onclick: () => { hidePopup(); sidebar.search(text); } }, icon('search', 16), 'Find'),
    el('button.pop-act', { onclick: () => { window.api.openExternal(`https://en.wiktionary.org/wiki/${encodeURIComponent(text.split(/\s+/).slice(0, 3).join(' ').toLowerCase())}`); hidePopup(); } }, icon('globe', 16), 'Define'),
    el('button.pop-act', { onclick: () => { window.api.openExternal(`https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(text.slice(0, 200))}`); hidePopup(); } }, icon('info', 16), 'Wiki'),
    el('button.pop-act', { onclick: () => { tts.speakText(text); hidePopup(); } }, icon('speaker', 16), 'Speak'),
    existing ? el('button.pop-act.danger', { onclick: () => { remove(existing.id); hidePopup(); toast('Highlight removed'); } }, icon('trash', 16), 'Delete') : null);

  setChildren(p, 
    el('div.pop-row', colors),
    el('div.pop-row', styles),
    existing?.note ? el('div.pop-note', existing.note) : null,
    actions);
  p.hidden = false;
  const w = p.offsetWidth, h = p.offsetHeight;
  let top = at.top - h - 12;
  if (top < 50) top = (at.bottom ?? at.y) + 12;
  if (top + h > innerHeight - 8) top = innerHeight - h - 8;
  const left = Math.min(Math.max(8, (at.x ?? 0) - w / 2), innerWidth - w - 8);
  p.style.top = `${top}px`;
  p.style.left = `${left}px`;
}

document.addEventListener('pointerdown', (e) => {
  const p = $('#sel-popup');
  if (p && !p.hidden && !p.contains(e.target) && !e.target.closest('.modal-backdrop')) hidePopup();
});

// ---------- export ----------
export function toMarkdown() {
  const m = R.meta;
  const lines = [`# ${m.title}`, m.author ? `*${m.author}*` : '', '', `Exported from Margins on ${new Date().toLocaleDateString()}`, ''];
  let lastChapter = null;
  for (const a of sortByPosition(items)) {
    if (a.chapter !== lastChapter) { lines.push(`## ${a.chapter || 'Untitled section'}`, ''); lastChapter = a.chapter; }
    if (a.type === 'bookmark') lines.push(`- 🔖 Bookmark (${Math.round(a.percent * 100)}%): ${a.text}`, '');
    else {
      lines.push(...a.text.split('\n').map((l) => `> ${l}`));
      lines.push('', `<sub>${a.color} · ${a.style} · ${Math.round(a.percent * 100)}%</sub>`, '');
      if (a.note) lines.push(a.note, '');
    }
  }
  return lines.join('\n');
}

export function toHtml() {
  const m = R.meta;
  const rows = sortByPosition(highlights()).map((a) => `<blockquote style="border-left:4px solid ${colorHex(a.color)};padding:.4em 1em;margin:1em 0">${escapeHtml(a.text)}${a.note ? `<p><em>${escapeHtml(a.note)}</em></p>` : ''}<footer style="font-size:.8em;opacity:.6">${escapeHtml(a.chapter || '')} · ${Math.round(a.percent * 100)}%</footer></blockquote>`);
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(m.title)} — highlights</title><body style="font-family:Georgia,serif;max-width:720px;margin:3em auto;line-height:1.6"><h1>${escapeHtml(m.title)}</h1><p>${escapeHtml(m.author || '')}</p>${rows.join('\n')}</body>`;
}

export async function exportAnnotations(format = 'md') {
  if (!R.meta) { toast('Open a book first'); return; }
  const base = (R.meta.title || 'book').replace(/[\\/:*?"<>|]+/g, '').slice(0, 80);
  const map = {
    md: [toMarkdown(), 'Markdown', 'md'],
    json: [JSON.stringify({ book: { title: R.meta.title, author: R.meta.author }, annotations: sortByPosition(items) }, null, 2), 'JSON', 'json'],
    html: [toHtml(), 'Web page', 'html'],
  };
  const [content, name, ext] = map[format];
  const saved = await window.api.file.save({ defaultPath: `${base} — highlights.${ext}`, content, filters: [{ name, extensions: [ext] }] });
  if (saved) toast('Exported');
}

export async function importAnnotations() {
  const text = await window.api.file.openJson();
  if (!text) return;
  try {
    const data = JSON.parse(text);
    const incoming = (data.annotations || data).filter((a) => a.cfi && a.type);
    const known = new Set(items.map((a) => `${a.type}|${a.cfi}`));
    let n = 0;
    for (const a of incoming) if (!known.has(`${a.type}|${a.cfi}`)) { items.push({ ...a, id: uid() }); n++; }
    save(); renderAll();
    toast(`Imported ${n} annotation${n === 1 ? '' : 's'}`);
  } catch { toast('That file is not a Margins annotations export'); }
}

export async function jumpTo(a) {
  await goTo(a.cfi);
  flash(a.cfi);
}
