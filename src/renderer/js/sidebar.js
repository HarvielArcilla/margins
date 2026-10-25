// The left sidebar: contents, highlights & notes, bookmarks, and search.
import { $, setChildren, $$, el, icon, iconButton, popupMenu, promptDialog, toast, debounce, escapeHtml } from './ui.js';
import { R, goTo, currentChapter } from './reader.js';
import * as A from './annotations.js';
import { HIGHLIGHT_STYLES } from './themes.js';

let tab = 'toc';
let filters = { color: null, style: null, q: '', sort: 'position', notesOnly: false };
let searchState = { query: '', results: [], running: false, token: 0 };

export function isOpen() { return document.body.classList.contains('sidebar-open'); }

export function open(which = tab) {
  tab = which;
  document.body.classList.add('sidebar-open');
  render();
  if (which === 'search') setTimeout(() => $('#search-input')?.focus(), 50);
}

export function close() { document.body.classList.remove('sidebar-open'); }

export function toggle(which) {
  if (isOpen() && (!which || which === tab)) close(); else open(which || tab);
}

export function bookOpened() {
  searchState = { query: '', results: [], running: false, token: searchState.token + 1 };
  filters = { color: null, style: null, q: '', sort: 'position', notesOnly: false };
  if (isOpen()) render();
}

export function locationChanged() {
  if (!isOpen() || tab !== 'toc') return;
  const ch = currentChapter();
  $$('.toc-item').forEach((n) => n.classList.toggle('current', ch && n.dataset.href === ch.href));
}

A.onChange(() => { if (isOpen() && (tab === 'notes' || tab === 'bookmarks')) render(); });

function render() {
  const root = $('#sidebar');
  if (!R.open) return;
  const tabs = [['toc', 'Contents', 'list'], ['notes', 'Notes', 'highlighter'], ['bookmarks', 'Marks', 'bookmark'], ['search', 'Search', 'search']];
  setChildren(root, 
    el('div.side-tabs', tabs.map(([id, label, ic]) =>
      el('button.side-tab', { class: `side-tab ${tab === id ? 'on' : ''}`, onclick: () => { tab = id; render(); if (id === 'search') $('#search-input')?.focus(); } }, icon(ic, 16), el('span', label))),
    iconButton('x', 'Close sidebar', close)),
    el('div.side-body', { 'data-tab': tab }, { toc: renderToc, notes: renderNotes, bookmarks: renderBookmarks, search: renderSearch }[tab]()));
  if (tab === 'toc') $('.toc-item.current')?.scrollIntoView({ block: 'center' });
}

// ---------- contents ----------
function renderToc() {
  if (!R.toc.length) return el('p.empty', 'This book has no table of contents.');
  const ch = currentChapter();
  const collapsed = new Set(JSON.parse(sessionStorage.getItem('toc-collapsed') || '[]'));
  const out = [];
  let hideBelow = Infinity;
  R.toc.forEach((t, i) => {
    if (t.depth > hideBelow) return;
    hideBelow = Infinity;
    const hasKids = R.toc[i + 1] && R.toc[i + 1].depth > t.depth;
    const isCollapsed = collapsed.has(t.href);
    if (hasKids && isCollapsed) hideBelow = t.depth;
    const pct = tocPercent(t);
    out.push(el('div.toc-item', {
      class: `toc-item ${ch && ch.href === t.href ? 'current' : ''}`,
      dataset: { href: t.href },
      style: { paddingLeft: `${12 + t.depth * 16}px` },
      onclick: () => goTo(t.href),
    },
    hasKids ? el('button.toc-twisty', {
      onclick: (e) => {
        e.stopPropagation();
        if (isCollapsed) collapsed.delete(t.href); else collapsed.add(t.href);
        sessionStorage.setItem('toc-collapsed', JSON.stringify([...collapsed]));
        render();
      },
    }, icon(isCollapsed ? 'forward' : 'scroll', 13)) : el('span.toc-twisty'),
    el('span.toc-label', t.label || 'Untitled'),
    pct != null ? el('span.toc-pct', `${Math.round(pct * 100)}%`) : null));
  });
  return el('div.toc', out);
}

function tocPercent(t) {
  try {
    if (!R.book.locations.length()) return null;
    const sec = R.book.spine.get(t.href);
    if (!sec) return null;
    return R.book.locations.percentageFromCfi(`epubcfi(${sec.cfiBase}!/4/2)`);
  } catch { return null; }
}

// ---------- notes ----------
function filteredNotes() {
  let list = A.highlights();
  if (filters.color) list = list.filter((a) => a.color === filters.color);
  if (filters.style) list = list.filter((a) => a.style === filters.style);
  if (filters.notesOnly) list = list.filter((a) => a.note);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    list = list.filter((a) => a.text.toLowerCase().includes(q) || (a.note || '').toLowerCase().includes(q));
  }
  return filters.sort === 'position' ? A.sortByPosition(list) : [...list].sort((a, b) => b.createdAt - a.createdAt);
}

function renderNotes() {
  const used = [...new Set(A.highlights().map((a) => a.color))];
  const usedStyles = [...new Set(A.highlights().map((a) => a.style))];

  const toolbar = el('div.notes-toolbar',
    el('input.input.small', {
      placeholder: 'Filter highlights…', value: filters.q,
      oninput: debounce((e) => { filters.q = e.target.value; refreshList(); }, 150),
    }),
    iconButton('download', 'Export', (e) => popupMenu(e.currentTarget, [
      { label: 'Export as Markdown', icon: 'note', onclick: () => A.exportAnnotations('md') },
      { label: 'Export as web page', icon: 'globe', onclick: () => A.exportAnnotations('html') },
      { label: 'Export as JSON', icon: 'download', onclick: () => A.exportAnnotations('json') },
      { label: 'Copy all as Markdown', icon: 'copy', onclick: () => { navigator.clipboard.writeText(A.toMarkdown()); toast('Copied'); } },
      '-',
      { label: 'Import from JSON…', icon: 'upload', onclick: () => A.importAnnotations() },
    ])));
  const chips = el('div.chips',
    el('button.chip', { class: `chip ${!filters.color && !filters.style && !filters.notesOnly ? 'on' : ''}`, onclick: () => { filters.color = null; filters.style = null; filters.notesOnly = false; render(); } }, `All ${A.highlights().length}`),
    el('button.chip', { class: `chip ${filters.notesOnly ? 'on' : ''}`, onclick: () => { filters.notesOnly = !filters.notesOnly; render(); } }, icon('note', 13), 'With notes'),
    used.map((c) => el('button.chip.color-chip', {
      class: `chip color-chip ${filters.color === c ? 'on' : ''}`, style: { '--c': A.colorHex(c) }, title: c,
      onclick: () => { filters.color = filters.color === c ? null : c; render(); },
    }, el('span.dot'))),
    usedStyles.length > 1 ? usedStyles.map((st) => el('button.chip', {
      class: `chip ${filters.style === st ? 'on' : ''}`,
      onclick: () => { filters.style = filters.style === st ? null : st; render(); },
    }, HIGHLIGHT_STYLES.find((x) => x.id === st)?.name.split(' ')[0] || st)) : null,
    el('button.chip', { onclick: () => { filters.sort = filters.sort === 'position' ? 'recent' : 'position'; render(); } }, filters.sort === 'position' ? 'Book order' : 'Newest first'));

  const listEl = el('div.note-list');
  const refreshList = () => { setChildren(listEl, ...noteCards(filteredNotes())); };
  listEl.append(...noteCards(filteredNotes()));
  if (!A.highlights().length) {
    return el('div', toolbar, el('p.empty', 'Select text in the book to highlight it. Pick a color and a style — highlight, underline, squiggle, strikethrough and more — and add notes.'));
  }
  return el('div', toolbar, chips, listEl);

  function noteCards(l) {
    if (!l.length) return [el('p.empty', 'Nothing matches.')];
    return l.map((a) => el('div.note-card', { style: { '--c': A.colorHex(a.color) }, onclick: () => A.jumpTo(a) },
      el('div.note-meta', el('span', a.chapter || ''), el('span', `${Math.round((a.percent || 0) * 100)}%`)),
      el('blockquote', { class: `quote st-${a.style}` }, a.text),
      a.note ? el('p.note-text', a.note) : null,
      el('div.note-actions',
        el('button.link-btn', { onclick: async (e) => { e.stopPropagation(); const n = await promptDialog('Note', a.text.slice(0, 140), a.note || '', { multiline: true }); if (n != null) A.update(a.id, { note: n }); } }, a.note ? 'Edit note' : 'Add note'),
        el('button.link-btn', { onclick: (e) => { e.stopPropagation(); navigator.clipboard.writeText(a.note ? `${a.text}\n\n${a.note}` : a.text); toast('Copied'); } }, 'Copy'),
        el('button.link-btn.danger', { onclick: (e) => { e.stopPropagation(); A.remove(a.id); } }, 'Delete'))));
  }
}

// ---------- bookmarks ----------
function renderBookmarks() {
  const list = A.sortByPosition(A.bookmarks());
  return el('div',
    el('button.btn.full', { onclick: () => A.toggleBookmark() }, icon('bookmark', 16), A.isBookmarked() ? 'Remove bookmark here' : 'Bookmark this page'),
    list.length ? el('div.note-list', list.map((b) => el('div.note-card.bm', { onclick: () => A.jumpTo(b) },
      el('div.note-meta', el('span', b.chapter || ''), el('span', `${Math.round((b.percent || 0) * 100)}%`)),
      el('p.bm-text', b.note || b.text || 'Bookmark'),
      el('div.note-actions',
        el('button.link-btn', { onclick: async (e) => { e.stopPropagation(); const n = await promptDialog('Bookmark name', '', b.note || ''); if (n != null) A.update(b.id, { note: n }); } }, 'Rename'),
        el('button.link-btn.danger', { onclick: (e) => { e.stopPropagation(); A.remove(b.id); } }, 'Delete')))))
      : el('p.empty', 'No bookmarks yet. Press B or the ribbon in the top bar.'));
}

// ---------- search ----------
function renderSearch() {
  const input = el('input.input#search-input', {
    placeholder: 'Search this book…', value: searchState.query, type: 'search',
    onkeydown: (e) => { if (e.key === 'Enter') runSearch(e.target.value); e.stopPropagation(); },
  });
  const results = el('div.search-results');
  paintResults(results);
  return el('div', el('div.search-box', input, el('button.btn.primary', { onclick: () => runSearch(input.value) }, 'Find')), results);
}

function paintResults(root = $('.search-results')) {
  if (!root) return;
  const s = searchState;
  const header = s.query
    ? el('p.search-status', s.running ? `Searching… ${s.results.length} found` : `${s.results.length} result${s.results.length === 1 ? '' : 's'} for “${s.query}”`)
    : el('p.empty', 'Find words or phrases anywhere in the book.');
  let lastCh = null;
  const rows = [];
  for (const r of s.results.slice(0, 500)) {
    if (r.chapter !== lastCh) { rows.push(el('div.search-ch', r.chapter || '')); lastCh = r.chapter; }
    const ex = escapeHtml(r.excerpt);
    const re = new RegExp(escapeHtml(s.query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    rows.push(el('button.search-hit', { html: ex.replace(re, (m) => `<mark>${m}</mark>`), onclick: async () => { await goTo(r.cfi); A.mark('m-search', r.cfi); } }));
  }
  setChildren(root, header, ...rows);
}

export async function search(query) {
  open('search');
  await runSearch(query);
}

async function runSearch(query) {
  query = (query || '').trim();
  const token = ++searchState.token;
  searchState = { query, results: [], running: !!query, token };
  if ($('#search-input')) $('#search-input').value = query;
  paintResults();
  if (!query || !R.book) return;
  const book = R.book;
  for (const item of book.spine.spineItems) {
    if (searchState.token !== token) return;
    try {
      await item.load(book.load.bind(book));
      const found = item.find(query);
      item.unload();
      const chapter = chapterForSpine(item.index);
      for (const f of found) searchState.results.push({ ...f, chapter });
    } catch { /* unreadable section */ }
    paintResults();
    await new Promise((r) => setTimeout(r, 0));
  }
  searchState.running = false;
  paintResults();
}

function chapterForSpine(idx) {
  let best = null;
  for (const t of R.toc) if (t.spineIndex >= 0 && t.spineIndex <= idx && (!best || t.spineIndex >= best.spineIndex)) best = t;
  return best?.label || '';
}

export function clearSearchMarks() { A.mark('m-search', null); }
