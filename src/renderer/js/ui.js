// DOM helpers, icons, toasts, menus and modals shared by every view.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// el('div.card#main', { onclick, title }, child, 'text', [more children])
export function el(spec, attrs = {}, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const node = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') node.classList.add(part.slice(1));
    else node.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = {};
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    }
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

// replaceChildren that skips null/false and flattens arrays, like el().
export function setChildren(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  forward: '<path d="M9 18l6-6-6-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  aa: '<path d="M3 19l5-13 5 13M5 14h6M15.5 13.5c.6-1.2 1.6-1.8 3-1.8 1.9 0 2.9 1 2.9 2.8V19M21.4 15.8c-4.2 0-6.4.8-6.4 1.9 0 .9.8 1.5 1.9 1.5 2 0 4.5-1.2 4.5-3.4"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  shrink: '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  pause: '<path d="M7 4h4v16H7zM14 4h4v16h-4z"/>',
  speaker: '<path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  chart: '<path d="M3 3v18h18M7 16v-5M12 16V8M17 16v-8"/>',
  library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  rows: '<path d="M3 5h18M3 12h18M3 19h18"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  focus: '<circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01"/>',
  highlighter: '<path d="M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  layers: '<path d="M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 15h10"/>',
  scroll: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  pin: '<path d="M12 17v5M9 10.8V4h6v6.8l3 3.2H6z"/>',
  sparkle: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>',
  ruler: '<path d="M2 12h20M2 8h20M2 16h20"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

export function iconButton(name, title, onclick, extra = {}) {
  return el('button.icon-btn', { title, 'aria-label': title, onclick, ...extra }, icon(name));
}

let toastTimer = null;
export function toast(message, ms = 2200) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Small dropdown menu anchored to an element. items: [{label, icon, onclick, danger, checked}] | '-'
export function popupMenu(anchor, items) {
  closeMenus();
  const menu = el('div.popup-menu', { role: 'menu' },
    items.map((it) => it === '-'
      ? el('div.menu-sep')
      : el('button.menu-item', {
        class: it.danger ? 'menu-item danger' : 'menu-item',
        onclick: (e) => { e.stopPropagation(); closeMenus(); it.onclick?.(); },
      }, it.icon ? icon(it.icon, 16) : el('span.icon'), el('span', it.label), it.checked ? icon('check', 14) : null)));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = Math.min(r.left, innerWidth - mw - 8);
  let top = r.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
  function onOutside(e) { if (!menu.contains(e.target)) closeMenus(); }
  menu._cleanup = () => document.removeEventListener('pointerdown', onOutside, true);
  return menu;
}

export function closeMenus() {
  for (const m of $$('.popup-menu')) { m._cleanup?.(); m.remove(); }
}

const modalStack = [];
export function closeTopModal() {
  const top = modalStack.at(-1);
  if (top) { top(); return true; }
  return false;
}

// Modal dialog. Returns { close, root }.
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const root = el('div.modal-backdrop');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
    document.removeEventListener('keydown', onKey, true);
    modalStack.splice(modalStack.indexOf(close), 1);
    onClose?.();
  };
  modalStack.push(close);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const box = el(`div.modal${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-label': title, tabindex: -1 },
    el('header.modal-head', el('h2', title), iconButton('x', 'Close', close)),
    el('div.modal-body', body),
    actions.length ? el('footer.modal-actions', actions.map((a) =>
      el(`button.btn${a.primary ? '.primary' : ''}${a.danger ? '.danger' : ''}`, {
        onclick: async () => { if ((await a.onclick?.()) !== false) close(); },
      }, a.label))) : null);
  root.append(box);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  document.addEventListener('keydown', onKey, true);
  $('#modal-root').append(root);
  // Take focus out of the book page so keys reach the dialog.
  setTimeout(() => (box.querySelector('input,textarea,select,button.primary') || box).focus(), 30);
  return { close, root: box };
}

export function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title,
      body: el('p.muted', message),
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { label: 'Cancel', onclick: () => { answered = true; resolve(false); } },
        { label: okLabel, primary: !danger, danger, onclick: () => { answered = true; resolve(true); } },
      ],
    });
  });
}

export function promptDialog(title, label, value = '', { multiline = false, placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const input = multiline
      ? el('textarea.input', { rows: 6, placeholder }, value)
      : el('input.input', { value, placeholder });
    const submit = () => { answered = true; resolve(input.value); };
    if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { submit(); dlg.close(); } });
    const dlg = modal({
      title,
      body: el('label.field', el('span', label), input),
      onClose: () => { if (!answered) resolve(null); },
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onclick: submit }],
    });
  });
}

export const debounce = (fn, ms) => {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
};

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function formatDuration(ms, { short = false } = {}) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return short ? '<1m' : 'under a minute';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (short) return h ? `${h}h ${m}m` : `${m}m`;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function countWords(text) {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  // CJK text has no spaces; count characters / 2 as a rough word equivalent.
  const cjk = text.match(/[぀-ヿ㐀-鿿가-힯]/g);
  return (m ? m.length : 0) + (cjk ? Math.round(cjk.length / 2) : 0);
}

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
