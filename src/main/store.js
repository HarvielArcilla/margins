// Small JSON-on-disk store under the app's userData folder.
const fs = require('node:fs');
const path = require('node:path');
const { screen } = require('electron');

let root = null;
const cache = new Map();

function init(userData) {
  root = path.join(userData, 'library-data');
  for (const d of Object.values(dirs())) fs.mkdirSync(d, { recursive: true });
}

function dirs() {
  return {
    root,
    books: path.join(root, 'books'),
    covers: path.join(root, 'covers'),
    annotations: path.join(root, 'annotations'),
    fonts: path.join(root, 'fonts'),
    textures: path.join(root, 'textures'),
  };
}

function readJson(rel, fallback) {
  if (cache.has(rel)) return structuredClone(cache.get(rel));
  const file = path.join(root, rel);
  let value = fallback;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run or unreadable */ }
  cache.set(rel, value);
  return structuredClone(value);
}

function writeJson(rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
  cache.set(rel, structuredClone(value));
  return true;
}

function getWindowState() {
  const s = readJson('window.json', null);
  const fallback = { width: 1180, height: 820 };
  if (!s) return fallback;
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    s.x >= a.x - 50 && s.y >= a.y - 50 && s.x < a.x + a.width && s.y < a.y + a.height);
  return visible ? s : { ...fallback, maximized: s.maximized };
}

let saveTimer = null;
function saveWindowState(win) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (win.isDestroyed() || win.isFullScreen()) return;
    writeJson('window.json', { ...win.getNormalBounds(), maximized: win.isMaximized() });
  }, 400);
}

module.exports = { init, dirs, readJson, writeJson, getWindowState, saveWindowState };
