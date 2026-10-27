// How a book page is dressed: the reading stylesheet, highlights and
// fixation emphasis. Pure functions of (page, settings, theme, data), shared
// by the reader and the offscreen pager that renders neighbouring pages for
// page turns — so both draw a page exactly the same way.
import { buildContentCss } from './content-style.js';
import { highlightColors, isDark, rgba, mix } from './themes.js';

export function applyPageCss(contents, s, theme) {
  const doc = contents.document;
  let tag = doc.getElementById('m-reader-style');
  if (!tag) { tag = doc.createElement('style'); tag.id = 'm-reader-style'; doc.head.append(tag); }
  const css = buildContentCss(s, theme);
  if (tag.textContent !== css) tag.textContent = css;
  markGenericFont(doc, s);
}

// A book that only asks for "serif" (or names Times, the usual stand-in)
// hasn't chosen a face, it's asked for a kind of face. With the book's own
// fonts on, give it a good one of that kind rather than Times.
function markGenericFont(doc, s) {
  const root = doc.documentElement;
  root.removeAttribute('data-m-generic');
  if (s.font !== 'publisher' || !doc.body) return;
  const fam = doc.defaultView.getComputedStyle(doc.body).fontFamily.toLowerCase().replace(/["']/g, '').split(',').map((f) => f.trim());
  if (fam.every((f) => ['serif', 'times', 'times new roman', 'tinos', 'liberation serif'].includes(f))) root.setAttribute('data-m-generic', 'serif');
}

// ---------- highlights ----------
export function colorHex(id, s) {
  return highlightColors(s).find((c) => c.id === id)?.hex
    || (s?.customHighlightColors || []).find((c) => c.id === id)?.hex
    || (/^#[0-9a-f]{6}$/i.test(id) ? id : '#f6d23f');
}

const keyFor = (a, s) => `m-a-${a.style}-${colorHex(a.color, s).slice(1)}`;

function ruleFor(key, s, theme) {
  const [, , style, hex] = key.split('-');
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

const spineOf = (cfi) => {
  try { return new window.ePub.CFI(cfi).spinePos; } catch { return -1; }
};

// Draws highlight annotations into a page; returns [{a, range}] for hit tests.
export function drawHighlights(contents, items, s, theme) {
  const win = contents.window, doc = contents.document;
  const reg = win?.CSS?.highlights;
  if (!reg) return [];
  for (const k of [...reg.keys()]) if (k.startsWith('m-a-')) reg.delete(k);
  const groups = new Map();
  const hits = [];
  for (const a of items) {
    if (a.type !== 'highlight' || spineOf(a.cfi) !== contents.sectionIndex) continue;
    let range;
    try { range = contents.range(a.cfi); } catch { range = null; }
    if (!range || range.collapsed) continue;
    hits.push({ a, range });
    const k = keyFor(a, s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(range);
  }
  let css = '';
  for (const [k, ranges] of groups) {
    const h = new win.Highlight(...ranges);
    h.priority = 2;
    reg.set(k, h);
    css += ruleFor(k, s, theme) + '\n';
  }
  let tag = doc.getElementById('m-anno-style');
  if (!tag) { tag = doc.createElement('style'); tag.id = 'm-anno-style'; doc.head.append(tag); }
  if (tag.textContent !== css) tag.textContent = css;
  return hits;
}

// ---------- fixation emphasis ----------
// Dims the ends of words so the eye lands on their starts. Uses the CSS
// Custom Highlight API, so the book's DOM is never touched.
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

export function applyFixation(contents, s) {
  const win = contents.window;
  const reg = win?.CSS?.highlights;
  if (!reg) return;
  if (!s.fixation) { reg.delete('m-fix'); contents._fixKey = null; return; }
  const key = `${s.fixationStrength}`;
  if (contents._fixKey === key && reg.has('m-fix')) return;
  contents._fixKey = key;
  const doc = contents.document;
  const keep = 0.25 + (s.fixationStrength / 100) * 0.4; // share of each word kept bright
  const ranges = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('script,style,code,pre,svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.data;
    WORD.lastIndex = 0;
    for (let m = WORD.exec(text); m; m = WORD.exec(text)) {
      const len = m[0].length;
      if (len < 2) continue;
      const head = Math.max(1, Math.ceil(len * keep));
      if (head >= len) continue;
      const r = doc.createRange();
      r.setStart(n, m.index + head);
      r.setEnd(n, m.index + len);
      ranges.push(r);
    }
  }
  const hl = new win.Highlight(...ranges);
  hl.priority = 0;
  reg.set('m-fix', hl);
}
