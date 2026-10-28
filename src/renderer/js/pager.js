// The offscreen pager (see main.js): renders a given page of the open book
// — the current one, or the one after/before it — exactly as the reader
// draws it, so the main window can grab it as a picture for page turns.
import { applyChromeTheme, isDark } from './themes.js';
import { loadFonts } from './fonts.js';
import { applyPageCss, drawHighlights, applyFixation } from './page-style.js';
import * as paper from './paper.js';
import { findCover, findBackCover, showCover, coverPlan } from './cover.js';

window.__pager = true;
const $ = (s) => document.querySelector(s);
const frame = () => new Promise((r) => requestAnimationFrame(r));

let book = null, bookId = null, rendition = null, renditionKey = '';
let spec = null; // the request being rendered (settings etc. for the hooks)

let coverAt = -1, backAt = -1;
function dress(contents) {
  const spread = spec.s.flow === 'paginated' && spec.L.cols === 2;
  applyPageCss(contents, spec.s, spec.theme, {
    blankFirst: spread && coverAt >= 0 && contents.sectionIndex === coverAt + 1,
    endOnLeft: spread && backAt > 0 && contents.sectionIndex === backAt - 1 ? spec.L.width / 2 : 0,
    expand: () => { try { rendition?.manager?.views?.all?.().find((v) => v.contents === contents)?.expand(); } catch { /* gone */ } },
  });
  drawHighlights(contents, spec.items || [], spec.s, spec.theme);
  applyFixation(contents, spec.s);
}

function applyLook() {
  const { s, theme, stage, L, win } = spec;
  applyChromeTheme(theme);
  const rv = $('#reader-view');
  Object.assign(rv.style, { width: `${win.W}px`, height: `${win.H}px` });
  const fx = { dim: 1 - s.brightness / 100, warm: (s.warmth / 100) * 0.22, vignette: s.vignette / 100 };
  for (const [k, v] of Object.entries(fx)) {
    rv.style.setProperty(`--fx-${k}`, String(v));
    const n = rv.querySelector(`.fx-${k}`);
    if (n) n.hidden = v <= 0.001;
  }
  paper.apply(s, isDark(theme));
  paper.placeSpine(L, stage.left);
  // the desk shows around a cover
  if (s.deskColor) rv.style.setProperty('--desk', s.deskColor); else rv.style.removeProperty('--desk');
  // and its corners are rounded like the page's (as reader.applyPageSize works it out)
  const desk = (s.deskX ?? 0) > 0 || (s.deskY ?? 0) > 0;
  rv.classList.toggle('has-desk', desk);
  rv.style.setProperty('--page-radius', `${desk ? Math.max(0, Math.min(32, s.pageRadius || 0)) : 0}px`);
  Object.assign($('#stage').style, { left: `${stage.left}px`, top: `${stage.top}px`, width: `${stage.W}px`, height: `${stage.H}px`, bottom: 'auto', right: 'auto' });
  Object.assign($('#book').style, { position: 'absolute', left: `${L.padX}px`, top: `${L.padY}px`, width: `${L.width}px`, height: `${L.height}px` });
  document.body.dataset.flow = s.flow;
}

async function ensureBook(id) {
  if (bookId === id && book) return;
  try { rendition?.destroy(); } catch { /* gone */ }
  try { book?.destroy(); } catch { /* gone */ }
  rendition = null; renditionKey = '';
  const bytes = await window.api.library.read(id);
  book = window.ePub(bytes);
  await book.ready;
  // the same covers as the reader finds (the plain back cover needs no picture here)
  { const plan = await coverPlan(book, { picture: false }); coverAt = plan.front; backAt = plan.back; }
  bookId = id;
}

async function ensureRendition() {
  const { L, s } = spec;
  const key = JSON.stringify([bookId, L.width, L.height, L.cols, L.gap, s.flow]);
  if (rendition && key === renditionKey) {
    for (const c of rendition.getContents()) dress(c);
    return;
  }
  try { rendition?.destroy(); } catch { /* gone */ }
  $('#book').replaceChildren();
  rendition = book.renderTo($('#book'), {
    width: L.width, height: L.height, allowScriptedContent: false,
    spread: L.cols === 2 ? 'always' : 'none', minSpreadWidth: 0, resizeOnOrientationChange: false,
    flow: 'paginated', manager: 'default', gap: L.gap,
  });
  rendition.hooks.content.register((c) => dress(c));
  renditionKey = key;
}

async function settle() {
  await document.fonts?.ready;
  for (const c of rendition.getContents()) await c.document.fonts?.ready;
  // (and the page count evened out before a back cover)
  for (const c of rendition.getContents()) await c.__parity;
  await frame(); await frame();
}

let queue = Promise.resolve();
window.api.pager.onRender((req) => {
  queue = queue.then(() => render(req)).catch((e) => window.api.pager.done({ id: req.id, ok: false, error: String(e?.message || e) }));
});

async function render(req) {
  spec = req;
  applyLook();
  await ensureBook(req.bookId);
  await ensureRendition();
  // A freshly loaded section can still change size as its fonts and images
  // arrive, leaving epub.js on the wrong page: check and go again.
  // epub.js can land one page early when asked for a page that starts in
  // the middle of a paragraph (or before late fonts settle): step to it.
  const at = () => rendition.currentLocation()?.start?.cfi;
  await rendition.display(req.cfi);
  await settle();
  if (at() !== req.cfi) { await rendition.next(); await settle(); }
  if (at() !== req.cfi) { await rendition.display(req.cfi); await settle(); }
  if (at() !== req.cfi) { await rendition.prev(); await settle(); }
  if (at() !== req.cfi) throw new Error(`could not find the page ${req.cfi} (at ${at()})`);
  if (req.which === 'next' || req.which === 'prev') {
    const here = () => rendition.currentLocation();
    const before = here()?.start?.cfi;
    for (let tries = 0; tries < 3; tries++) {
      await rendition[req.which]();
      await settle();
      const l = here();
      if (l?.start?.cfi !== before || (req.which === 'next' ? l?.atEnd : l?.atStart)) break;
    }
  }
  // the cover is drawn as a cover here too, as on screen
  const shown = rendition.getContents()[0];
  await showCover($('#stage'), spec.s.flow === 'paginated' ? (findCover(shown) || findBackCover(shown, backAt)) : null, spec.L.cols);
  await frame();
  const loc = rendition.currentLocation();
  window.api.pager.done({ id: req.id, ok: true, cfi: loc?.start?.cfi || null, atEnd: !!loc?.atEnd, atStart: !!loc?.atStart });
}

await loadFonts();
window.api.pager.hello();
