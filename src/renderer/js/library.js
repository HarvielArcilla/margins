// The library: importing books (dialog, drag and drop, "Open with"),
// covers, shelves, tags, sorting and the grid/list views.
import { $, setChildren, el, icon, iconButton, popupMenu, toast, confirmDialog, promptDialog, modal, debounce, formatDuration } from './ui.js';
import { getSettings, setSettings } from './settings.js';
import { openBook } from './reader.js';
import { timeForBook } from './stats.js';
import { hexToRgb, mix } from './themes.js';

export let books = {};
let shelf = 'all';
let query = '';
let tag = null;

export async function loadLibrary() {
  books = await window.api.library.list();
  return books;
}

// ---------- import ----------
export async function importFiles(paths) {
  if (!paths?.length) return [];
  const added = [];
  const bar = progress(`Importing ${paths.length} book${paths.length > 1 ? 's' : ''}…`);
  let i = 0;
  for (const p of paths) {
    bar.set(++i / paths.length, p.split(/[\\/]/).pop());
    try {
      const { id, exists } = await window.api.library.addFile(p);
      if (!exists) {
        const meta = await readMetadata(id);
        books[id] = await window.api.library.upsert(id, { ...meta, fileName: p.split(/[\\/]/).pop() });
      }
      added.push(books[id] || await window.api.library.upsert(id, {}));
    } catch (e) {
      console.error(e);
      toast(`Couldn’t import ${p.split(/[\\/]/).pop()}`);
    }
  }
  bar.done();
  books = await window.api.library.list();
  render();
  if (added.length) toast(`Added ${added.length} book${added.length > 1 ? 's' : ''}`);
  return added;
}

async function readMetadata(id) {
  const bytes = await window.api.library.read(id);
  const book = window.ePub(bytes);
  try {
    await book.ready;
    const md = await book.loaded.metadata;
    let cover = null;
    try {
      const url = await book.coverUrl();
      if (url) cover = await window.api.library.saveCover(id, await thumbnail(url));
    } catch { /* no cover */ }
    return {
      title: (md.title || 'Untitled').trim(),
      author: (md.creator || '').trim(),
      publisher: md.publisher || '',
      language: md.language || '',
      description: md.description || '',
      published: md.pubdate || '',
      cover,
      progress: 0,
      tags: [],
    };
  } finally {
    // epub.js finishes swapping resource URLs asynchronously; destroying the
    // book mid-way throws, so let it settle first.
    setTimeout(() => { try { book.destroy(); } catch { /* already gone */ } }, 4000);
  }
}

function thumbnail(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = 360, h = Math.round(w * (img.naturalHeight / img.naturalWidth || 1.5));
      const c = document.createElement('canvas');
      c.width = w; c.height = Math.min(h, 720);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function progress(label) {
  const box = el('div.import-progress', el('div.ip-label', label), el('div.ip-file'), el('div.ip-bar', el('span')));
  document.body.append(box);
  return {
    set: (p, file) => { box.querySelector('.ip-bar span').style.width = `${p * 100}%`; box.querySelector('.ip-file').textContent = file; },
    done: () => setTimeout(() => box.remove(), 300),
  };
}

export async function pickAndImport() {
  const paths = await window.api.library.pick();
  return importFiles(paths);
}

// ---------- views ----------
const SHELVES = [
  ['all', 'All books'],
  ['reading', 'Reading'],
  ['unread', 'Not started'],
  ['finished', 'Finished'],
  ['favorites', 'Favorites'],
];

function filtered() {
  let list = Object.values(books);
  if (shelf === 'reading') list = list.filter((b) => !b.finishedAt && (b.progress || 0) > 0);
  if (shelf === 'unread') list = list.filter((b) => !b.finishedAt && !(b.progress > 0));
  if (shelf === 'finished') list = list.filter((b) => b.finishedAt);
  if (shelf === 'favorites') list = list.filter((b) => b.favorite);
  if (tag) list = list.filter((b) => (b.tags || []).includes(tag));
  if (query) {
    const q = query.toLowerCase();
    list = list.filter((b) => `${b.title} ${b.author} ${(b.tags || []).join(' ')}`.toLowerCase().includes(q));
  }
  const sort = getSettings().librarySort;
  const by = {
    recent: (a, b) => (b.lastReadAt || b.lastOpenedAt || b.addedAt || 0) - (a.lastReadAt || a.lastOpenedAt || a.addedAt || 0),
    added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    title: (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { numeric: true }),
    author: (a, b) => authorKey(a).localeCompare(authorKey(b)) || (a.title || '').localeCompare(b.title || ''),
    progress: (a, b) => (b.progress || 0) - (a.progress || 0),
    length: (a, b) => (b.words || 0) - (a.words || 0),
  }[sort] || (() => 0);
  return list.sort(by);
}

const authorKey = (b) => { const a = (b.author || '').trim(); const parts = a.split(/\s+/); return parts.length > 1 ? `${parts.at(-1)} ${parts.slice(0, -1).join(' ')}` : a; };

export function render() {
  const root = $('#library-view');
  const s = getSettings();
  const allTags = [...new Set(Object.values(books).flatMap((b) => b.tags || []))].sort();
  const continueBook = Object.values(books).filter((b) => !b.finishedAt && b.progress > 0 && b.lastReadAt).sort((a, b) => b.lastReadAt - a.lastReadAt)[0];

  const toolbar = el('div.lib-toolbar',
    el('div.search-field', icon('search', 16), el('input.input.bare', {
      placeholder: 'Search title, author, tag…', value: query, type: 'search',
      oninput: debounce((e) => { query = e.target.value; paintBooks(); }, 120),
    })),
    el('select.input.small', { title: 'Sort', onchange: (e) => { setSettings({ librarySort: e.target.value }); paintBooks(); } },
      [['recent', 'Recently read'], ['added', 'Recently added'], ['title', 'Title'], ['author', 'Author'], ['progress', 'Progress'], ['length', 'Length']]
        .map(([v, l]) => el('option', { value: v, selected: s.librarySort === v }, l))),
    el('div.seg.icons',
      el('button', { class: s.libraryView === 'grid' ? 'on' : '', title: 'Grid', onclick: () => { setSettings({ libraryView: 'grid' }); render(); } }, icon('grid', 16)),
      el('button', { class: s.libraryView === 'list' ? 'on' : '', title: 'List', onclick: () => { setSettings({ libraryView: 'list' }); render(); } }, icon('rows', 16))),
    s.libraryView === 'grid' ? el('input.size-slider', {
      type: 'range', min: 110, max: 260, step: 10, value: s.libraryCardSize, title: 'Cover size',
      oninput: (e) => { setSettings({ libraryCardSize: +e.target.value }); $('#lib-books').style.setProperty('--card', `${e.target.value}px`); },
    }) : null);

  const shelves = el('div.shelves',
    SHELVES.map(([id, label]) => el('button.chip', { class: `chip ${shelf === id && !tag ? 'on' : ''}`, onclick: () => { shelf = id; tag = null; render(); } }, label, el('span.count', String(countFor(id))))),
    allTags.map((t) => el('button.chip', { class: `chip ${tag === t ? 'on' : ''}`, onclick: () => { tag = tag === t ? null : t; render(); } }, icon('tag', 12), t)));

  const booksEl = el('div#lib-books', { class: s.libraryView === 'grid' ? 'book-grid' : 'book-list', style: { '--card': `${s.libraryCardSize}px` } });

  setChildren(root, 
    el('div.lib-wrap',
      el('header.lib-head', el('div', el('h1', 'Library'), el('p.muted', summary())), toolbar),
      continueBook && !query && shelf === 'all' && !tag ? continueCard(continueBook) : null,
      shelves, booksEl));
  paintBooks();

  function paintBooks() {
    const items = filtered();
    if (!Object.keys(books).length) {
      setChildren(booksEl, emptyState());
      return;
    }
    if (!items.length) { setChildren(booksEl, el('p.empty', 'No books match.')); return; }
    setChildren(booksEl, ...items.map((b) => (getSettings().libraryView === 'grid' ? gridCard(b) : listRow(b))));
  }
}

function summary() {
  const all = Object.values(books);
  if (!all.length) return 'Add ePub books to start reading';
  const reading = all.filter((b) => !b.finishedAt && b.progress > 0).length;
  const done = all.filter((b) => b.finishedAt).length;
  return [`${all.length} book${all.length === 1 ? '' : 's'}`, reading ? `${reading} in progress` : null, done ? `${done} finished` : null].filter(Boolean).join(' · ');
}

function countFor(id) {
  const prev = shelf; shelf = id;
  const savedQ = query, savedTag = tag; query = ''; tag = null;
  const n = filtered().length;
  shelf = prev; query = savedQ; tag = savedTag;
  return n;
}

function emptyState() {
  return el('div.empty-lib',
    el('div.empty-art', icon('library', 54)),
    el('h2', 'Your library is empty'),
    el('p.muted', 'Drop .epub files anywhere in this window, or import them.'),
    el('button.btn.primary', { onclick: pickAndImport }, icon('plus', 16), 'Import books'));
}

function continueCard(b) {
  return el('div.continue', { onclick: () => openBook(b) },
    cover(b, 'cover small'),
    el('div.cont-text',
      el('div.eyebrow', 'Continue reading'),
      el('div.cont-title', b.title),
      el('div.muted', [b.author, b.chapter].filter(Boolean).join(' · ')),
      el('div.progress-line', el('span', { style: { width: `${Math.round((b.progress || 0) * 100)}%` } })),
      el('div.muted.small', [`${Math.round((b.progress || 0) * 100)}%`, timeForBook(b.id) ? `${formatDuration(timeForBook(b.id), { short: true })} read` : null, b.lastReadAt ? `last read ${relDay(b.lastReadAt)}` : null].filter(Boolean).join(' · '))),
    el('button.btn.primary', icon('play', 14), 'Resume'));
}

function relDay(t) {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function cover(b, cls = 'cover') {
  if (b.cover) return el(`div.${cls.split(' ').join('.')}`, el('img', { src: b.cover, alt: '', loading: 'lazy', draggable: false }));
  // Generated cover from the title, coloured by a hash of it.
  let h = 0;
  for (const ch of `${b.title}${b.author}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hues = ['#7b4b2a', '#2f5d62', '#5c3c6e', '#7a2e3b', '#2e4a7a', '#4b6b33', '#8a5a14', '#3b3b4f'];
  const base = hues[h % hues.length];
  return el(`div.${cls.split(' ').join('.')}.generated`, {
    style: { background: `linear-gradient(160deg, ${mix(base, '#ffffff', 0.12)}, ${base} 60%, ${mix(base, '#000000', 0.3)})`, color: `rgba(${hexToRgb('#ffffff').join(',')},.95)` },
  }, el('div.gen-title', b.title || 'Untitled'), el('div.gen-author', b.author || ''));
}

function gridCard(b) {
  const pct = Math.round((b.progress || 0) * 100);
  return el('div.book-card', { tabindex: 0, onclick: () => openBook(b), onkeydown: (e) => { if (e.key === 'Enter') openBook(b); }, oncontextmenu: (e) => { e.preventDefault(); bookMenu(e.currentTarget, b); } },
    el('div.cover-wrap',
      cover(b),
      b.favorite ? el('span.fav', icon('heart', 14)) : null,
      b.finishedAt ? el('span.badge', 'Finished') : pct > 0 ? el('div.cover-progress', el('span', { style: { width: `${pct}%` } })) : el('span.badge.new', 'New')),
    el('div.card-text',
      el('div.card-title', { title: b.title }, b.title),
      el('div.card-author', b.author || ''),
      el('div.card-foot', el('span', b.finishedAt ? '✓ Read' : pct ? `${pct}%` : ''),
        iconButton('more', 'Book options', (e) => { e.stopPropagation(); bookMenu(e.currentTarget, b); }))));
}

function listRow(b) {
  const pct = Math.round((b.progress || 0) * 100);
  return el('div.book-row', { onclick: () => openBook(b), oncontextmenu: (e) => { e.preventDefault(); bookMenu(e.currentTarget, b); } },
    cover(b, 'cover tiny'),
    el('div.row-main', el('div.card-title', b.title), el('div.card-author', b.author || '')),
    el('div.row-tags', (b.tags || []).map((t) => el('span.tag', t))),
    el('div.row-prog', el('div.progress-line', el('span', { style: { width: `${pct}%` } })), el('span.small', b.finishedAt ? 'Finished' : `${pct}%`)),
    el('div.row-time.small.muted', b.lastReadAt ? new Date(b.lastReadAt).toLocaleDateString() : '—'),
    iconButton('more', 'Book options', (e) => { e.stopPropagation(); bookMenu(e.currentTarget, b); }));
}

function bookMenu(anchor, b) {
  const patch = async (p) => { books[b.id] = await window.api.library.upsert(b.id, p); render(); };
  popupMenu(anchor, [
    { label: 'Open', icon: 'library', onclick: () => openBook(b) },
    { label: 'Start from the beginning', icon: 'back', onclick: () => openBook(b, { at: 0 }) },
    '-',
    { label: b.favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'heart', onclick: () => patch({ favorite: !b.favorite }) },
    { label: b.finishedAt ? 'Mark as not finished' : 'Mark as finished', icon: 'check', onclick: () => patch(b.finishedAt ? { finishedAt: null } : { finishedAt: Date.now(), progress: 1 }) },
    { label: 'Edit tags…', icon: 'tag', onclick: async () => {
      const v = await promptDialog('Tags', 'Comma-separated, e.g. sci-fi, book club', (b.tags || []).join(', '));
      if (v != null) patch({ tags: [...new Set(v.split(',').map((t) => t.trim()).filter(Boolean))] });
    } },
    { label: 'Edit title & author…', icon: 'note', onclick: () => editDetails(b, patch) },
    { label: 'Book info', icon: 'info', onclick: () => info(b) },
    { label: 'Show file', icon: 'folder', onclick: () => window.api.library.reveal(b.id) },
    '-',
    { label: 'Remove from library', icon: 'trash', danger: true, onclick: async () => {
      if (!(await confirmDialog(`Remove “${b.title}”?`, 'The book, its highlights and its reading position will be deleted from Margins. The original file you imported is not touched.', 'Remove', true))) return;
      await window.api.library.remove(b.id);
      delete books[b.id];
      render();
    } },
  ]);
}

function editDetails(b, patch) {
  const title = el('input.input', { value: b.title || '' });
  const author = el('input.input', { value: b.author || '' });
  modal({
    title: 'Edit details',
    body: [el('label.field', el('span', 'Title'), title), el('label.field', el('span', 'Author'), author)],
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onclick: () => patch({ title: title.value.trim() || b.title, author: author.value.trim() }) }],
  });
}

function info(b) {
  const spent = timeForBook(b.id);
  modal({
    title: b.title,
    body: el('div.book-info',
      el('div.info-cover', cover(b)),
      el('dl',
        el('dt', 'Author'), el('dd', b.author || '—'),
        b.publisher ? [el('dt', 'Publisher'), el('dd', b.publisher)] : null,
        b.published ? [el('dt', 'Published'), el('dd', String(b.published).slice(0, 10))] : null,
        b.language ? [el('dt', 'Language'), el('dd', b.language)] : null,
        b.words ? [el('dt', 'Length'), el('dd', `${b.words.toLocaleString()} words`)] : null,
        el('dt', 'Added'), el('dd', new Date(b.addedAt).toLocaleDateString()),
        el('dt', 'Progress'), el('dd', `${Math.round((b.progress || 0) * 100)}%`),
        el('dt', 'Time spent'), el('dd', spent ? formatDuration(spent) : 'Not opened yet'))),
    actions: [{ label: 'Close' }, { label: 'Open book', primary: true, onclick: () => openBook(b) }],
  });
}

// ---------- drag & drop ----------
export function installDropZone() {
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { depth++; document.body.classList.add('dropping'); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dropping'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dropping');
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter((p) => /\.epub$/i.test(p));
    if (!paths.length) { toast('Drop .epub files to add them'); return; }
    const added = await importFiles(paths);
    if (added.length === 1 && document.body.dataset.view !== 'reader') openBook(added[0]);
  });
}
