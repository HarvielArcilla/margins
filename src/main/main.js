// Main process: the window, the app:// protocol that serves the reader and
// its fonts, and everything that touches the disk (library, settings,
// annotations, reading stats, imported fonts).
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const store = require('./store');

// Shown as Margins everywhere, also when run from source: the menu bar and
// Dock on macOS, the taskbar on Windows (which groups windows by this id, and
// otherwise shows them as Electron's).
app.setName('Margins');
if (process.platform === 'win32') app.setAppUserModelId('io.github.harvielarcilla.margins');
const APP_ICON = path.join(__dirname, '..', 'renderer', 'icon.png');

// Graphics options are read before the app is ready because Chromium only
// takes them at startup. They live outside the main store (which needs the
// app to be ready) in a tiny JSON file.
const GPU_FILE = path.join(app.getPath('userData'), 'graphics.json');
function readGraphics() {
  // Hardware acceleration is on everywhere; on Windows the flicker some
  // GPU/HDR setups showed is handled by the flicker fix below.
  const win = process.platform === 'win32';
  const defaults = { v: 2, hardwareAcceleration: true, srgb: win, flickerFix: win ? 'standard' : 'off' };
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(GPU_FILE, 'utf8')); } catch { /* none yet */ }
  // Before v2 acceleration was off by default on Windows and that default was
  // written into the file with any other change; start those on the new default.
  if (!saved.v) delete saved.hardwareAcceleration;
  return { ...defaults, ...saved, v: 2 };
}
const graphics = readGraphics();
if (!graphics.hardwareAcceleration) app.disableHardwareAcceleration();
// Keep WebGL (the page curl) available through Chromium's software renderer
// when there is no GPU, or when the GPU is on Chromium's blocklist. It only
// ever draws the app's own pages.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
// Pin colors to sRGB. With Windows HDR / NVIDIA RTX auto-HDR on, Chromium
// otherwise re-tonemaps every frame, which shows up as washed-out colors and
// flickering when layers change.
if (graphics.srgb) app.commandLine.appendSwitch('force-color-profile', 'srgb');
// Flicker with the GPU on (Windows, notably NVIDIA): Chromium hands its frames
// to Windows through DirectComposition and multi-plane overlays, which some
// drivers present out of step. 'standard' turns DirectComposition off (the
// GPU still draws everything); 'strong' also stops the GPU compositing layers.
if (process.platform === 'win32' && graphics.hardwareAcceleration) {
  if (graphics.flickerFix === 'standard' || graphics.flickerFix === 'strong') app.commandLine.appendSwitch('disable-direct-composition');
  if (graphics.flickerFix === 'strong') app.commandLine.appendSwitch('disable-gpu-compositing');
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const isMac = process.platform === 'darwin';
const RENDERER = path.join(__dirname, '..', 'renderer');
const NODE_MODULES = path.join(app.getAppPath(), 'node_modules');
const VENDOR = {
  'epub.min.js': path.join(NODE_MODULES, 'epubjs', 'dist', 'epub.min.js'),
  'jszip.min.js': path.join(NODE_MODULES, 'jszip', 'dist', 'jszip.min.js'),
};

let win = null;
const pendingOpen = [];
let rendererReady = false; // the page asks for queued files once it has booted

// ---------- app:// protocol ----------
function resolveAppUrl(url) {
  const { pathname } = new URL(url);
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const [top, ...rest] = rel.split('/');
  const safe = (base, parts) => {
    const p = path.normalize(path.join(base, ...parts));
    return p.startsWith(base) ? p : null;
  };
  if (top === 'vendor') return VENDOR[rest.join('/')] || null;
  if (top === 'userfonts') return safe(store.dirs().fonts, rest);
  if (top === 'usertextures') return safe(store.dirs().textures, rest);
  if (top === 'covers') return safe(store.dirs().covers, rest);
  return safe(RENDERER, rel ? rel.split('/') : ['index.html']);
}

function registerProtocol() {
  protocol.handle('app', async (request) => {
    const file = resolveAppUrl(request.url);
    if (!file || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    if (file.endsWith('.woff2')) headers.set('Content-Type', 'font/woff2');
    return new Response(res.body, { status: res.status, headers });
  });
}

// ---------- window ----------
function createWindow() {
  const bounds = store.getWindowState();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 520,
    minHeight: 420,
    show: false,
    backgroundColor: '#fbf9f4',
    icon: APP_ICON, // the window and taskbar icon on Windows and Linux
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    titleBarOverlay: isMac ? false : { color: '#fbf9f4', symbolColor: '#6b665e', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (bounds.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://reader/index.html');
  const save = () => store.saveWindowState(win);
  win.on('resize', save);
  win.on('move', save);
  win.on('close', save);
  win.on('closed', () => { if (pager && !pager.isDestroyed()) pager.destroy(); });
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen', false));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  win.webContents.on('did-start-loading', () => { rendererReady = false; });
}

function flushPendingOpen() {
  if (!win || !rendererReady) return;
  while (pendingOpen.length) win.webContents.send('library:open-path', pendingOpen.shift());
}

function queueOpen(file) {
  if (!file || !/\.epub$/i.test(file)) return;
  pendingOpen.push(file);
  flushPendingOpen();
}

function buildMenu() {
  const send = (ch, ...a) => () => win && win.webContents.send(ch, ...a);
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Import Books…', accelerator: 'CmdOrCtrl+O', click: send('menu', 'import') },
        { label: 'Library', accelerator: 'CmdOrCtrl+L', click: send('menu', 'library') },
        { label: 'Reading Stats', accelerator: 'CmdOrCtrl+Shift+S', click: send('menu', 'stats') },
        { type: 'separator' },
        { label: 'Export Annotations…', accelerator: 'CmdOrCtrl+E', click: send('menu', 'export-annotations') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reading Settings', accelerator: 'CmdOrCtrl+,', click: send('menu', 'settings') },
        { label: 'Contents', accelerator: 'CmdOrCtrl+T', click: send('menu', 'toc') },
        { label: 'Find in Book', accelerator: 'CmdOrCtrl+F', click: send('menu', 'search') },
        { label: 'Focus Mode', accelerator: 'CmdOrCtrl+Shift+F', click: send('menu', 'focus') },
        { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: send('menu', 'shortcuts') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Project on GitHub', click: () => shell.openExternal('https://github.com/HarvielArcilla/margins') }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- snapshots ----------
// Returns { width, height, data (BGRA), order } or { error }.
// BGRA → RGBA in place, here rather than in the page so the reader's own
// thread never spends time on it.
function toRGBA(data) {
  if (data.byteOffset % 4) data = Buffer.from(data); // needs 4-byte alignment
  const u = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
  for (let i = 0; i < u.length; i++) {
    const v = u[i];
    u[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >>> 16) & 0xff);
  }
  return data;
}

function bitmapOf(img, rect) {
  if (!img || img.isEmpty()) return { error: 'empty capture' };
  const data = img.toBitmap();
  if (!data?.length) return { error: 'empty bitmap' };
  // Work out the pixel size from the data: on scaled displays (125%, 150%)
  // the image's own size can be reported in either pixels or points.
  const px = data.length / 4;
  const candidates = [];
  const scales = typeof img.getScaleFactors === 'function' ? img.getScaleFactors() : [];
  for (const sc of [...scales, 1]) { const z = img.getSize(sc); candidates.push([z.width, z.height]); }
  const k = Math.sqrt(px / (rect.width * rect.height));
  candidates.push([Math.round(rect.width * k), Math.round(rect.height * k)]);
  for (const [w, h] of candidates) {
    for (const dw of [0, -1, 1]) {
      const ww = w + dw;
      if (ww > 0 && px % ww === 0 && Math.abs(px / ww - h) <= 1) return { width: ww, height: px / ww, data: toRGBA(data), order: 'rgba' };
    }
  }
  // last resort: resample to the requested size in points
  const r = img.resize({ width: Math.round(rect.width), height: Math.round(rect.height) });
  const d = r.toBitmap();
  return { width: Math.round(rect.width), height: d.length / 4 / Math.round(rect.width), data: toRGBA(d), order: 'rgba' };
}

async function rawCapture(wc, rect) {
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  try {
    return bitmapOf(await wc.capturePage(r), r);
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

// ---------- the pager ----------
// A hidden, offscreen window that renders the pages next to the one being
// read (with the same settings, size and highlights), so a page turn can
// show the real next page from its first frame. Offscreen rendering works
// with or without a GPU.
let pager = null;
let pagerReady = null;
let pagerSeq = 0;
let pagerIdle = null;
let lastPaint = null;
let pagerScale = 1;

// scale: the reader's devicePixelRatio, so pictures are as sharp as the page
// on screen (2 on Retina displays). Changing it means a new pager.
function ensurePager(scale = 1) {
  if (pager && !pager.isDestroyed() && pagerScale === scale) return;
  if (pager && !pager.isDestroyed()) pager.destroy();
  pagerScale = scale;
  pager = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      offscreen: { deviceScaleFactor: scale },
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  pager.webContents.setFrameRate(30);
  pager.webContents.on('paint', (_e, _dirty, image) => { lastPaint = image; pagerPainted?.(); });
  pagerReady = new Promise((resolve) => {
    const onHello = (e) => { if (e.sender === pager.webContents) { ipcMain.removeListener('pager:hello', onHello); resolve(); } };
    ipcMain.on('pager:hello', onHello);
  });
  pager.loadURL('app://reader/pager.html');
  const w = pager;
  w.on('closed', () => { if (pager === w) { pager = null; lastPaint = null; } });
}
let pagerPainted = null;

function closePagerSoon() {
  clearTimeout(pagerIdle);
  pagerIdle = setTimeout(() => { if (pager && !pager.isDestroyed()) pager.destroy(); }, 3 * 60 * 1000);
}

// One page at a time: each render is captured before the next one starts.
let pagerQueue = Promise.resolve();
function pagerRender(spec) {
  const run = pagerQueue.then(() => pagerRenderNow(spec));
  pagerQueue = run.catch(() => {});
  return run;
}

async function pagerRenderNow(spec) {
  try {
    ensurePager(Math.max(1, Math.min(3, +spec.dpr || 1)));
    await pagerReady;
    closePagerSoon();
    const [cw, ch] = pager.getContentSize();
    if (cw !== spec.win.W || ch !== spec.win.H) pager.setContentSize(spec.win.W, spec.win.H);
    const id = ++pagerSeq;
    const done = new Promise((resolve) => {
      const timer = setTimeout(() => { ipcMain.removeListener('pager:done', onDone); resolve({ id, ok: false, error: 'timeout' }); }, 6000);
      function onDone(e, msg) {
        if (e.sender !== pager?.webContents || msg.id !== id) return;
        clearTimeout(timer);
        ipcMain.removeListener('pager:done', onDone);
        resolve(msg);
      }
      ipcMain.on('pager:done', onDone);
    });
    pager.webContents.send('pager:render', { ...spec, id });
    const msg = await done;
    if (!msg.ok) return msg;
    // make sure a frame with the new page has been painted, then grab it
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 400);
      pagerPainted = () => { pagerPainted = null; clearTimeout(t); resolve(); };
      pager.webContents.invalidate();
    });
    const rect = spec.stage;
    let shot = await rawCapture(pager.webContents, { x: rect.left, y: rect.top, width: rect.W, height: rect.H });
    if (shot.error && lastPaint && !lastPaint.isEmpty()) {
      const full = lastPaint.getSize();
      const k = full.width / spec.win.W;
      const crop = lastPaint.crop({ x: Math.round(rect.left * k), y: Math.round(rect.top * k), width: Math.round(rect.W * k), height: Math.round(rect.H * k) });
      shot = bitmapOf(crop, { width: rect.W, height: rect.H });
    }
    return { ...msg, ...shot };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ---------- IPC ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

function registerIpc() {
  handle('settings:get', () => store.readJson('settings.json', {}));
  handle('settings:set', (s) => store.writeJson('settings.json', s));

  handle('library:list', () => store.readJson('library.json', { books: {} }).books);
  handle('library:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Import books',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'ePub books', extensions: ['epub'] }],
    });
    return r.canceled ? [] : r.filePaths;
  });
  handle('library:add-file', (file) => {
    const bytes = fs.readFileSync(file);
    const id = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 16);
    const dest = path.join(store.dirs().books, `${id}.epub`);
    const lib = store.readJson('library.json', { books: {} });
    const exists = !!lib.books[id];
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, bytes);
    return { id, exists, fileName: path.basename(file) };
  });
  handle('library:read', (id) => {
    const buf = fs.readFileSync(path.join(store.dirs().books, `${id}.epub`));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });
  handle('library:upsert', (id, patch) => {
    const lib = store.readJson('library.json', { books: {} });
    lib.books[id] = { ...(lib.books[id] || { id, addedAt: Date.now() }), ...patch };
    store.writeJson('library.json', lib);
    return lib.books[id];
  });
  handle('library:remove', (id) => {
    const lib = store.readJson('library.json', { books: {} });
    delete lib.books[id];
    store.writeJson('library.json', lib);
    const d = store.dirs();
    for (const f of [path.join(d.books, `${id}.epub`), path.join(d.covers, `${id}.png`), path.join(d.annotations, `${id}.json`), path.join(d.root, 'cache', `${id}.json`)]) {
      fs.rmSync(f, { force: true });
    }
  });
  handle('library:save-cover', (id, dataUrl) => {
    const m = /^data:image\/\w+;base64,(.+)$/.exec(dataUrl || '');
    if (!m) return null;
    fs.writeFileSync(path.join(store.dirs().covers, `${id}.png`), Buffer.from(m[1], 'base64'));
    return `app://reader/covers/${id}.png?v=${Date.now()}`;
  });
  handle('library:take-pending', () => { rendererReady = true; return pendingOpen.splice(0); });
  handle('library:reveal', (id) => shell.showItemInFolder(path.join(store.dirs().books, `${id}.epub`)));

  handle('annotations:get', (id) => store.readJson(path.join('annotations', `${id}.json`), { items: [] }).items);
  handle('annotations:set', (id, items) => store.writeJson(path.join('annotations', `${id}.json`), { items }));

  handle('stats:get', () => store.readJson('stats.json', { sessions: [] }));
  handle('stats:set', (s) => store.writeJson('stats.json', s));

  handle('fonts:list', () => store.readJson('userfonts.json', { fonts: [] }).fonts);
  handle('fonts:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Add fonts',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
    });
    const data = store.readJson('userfonts.json', { fonts: [] });
    for (const file of r.canceled ? [] : r.filePaths) {
      const base = path.basename(file);
      const safeName = base.replace(/[^\w.\-]+/g, '_');
      fs.copyFileSync(file, path.join(store.dirs().fonts, safeName));
      const name = path.parse(base).name.replace(/[-_](regular|book|roman)$/i, '').replace(/[-_]+/g, ' ');
      if (!data.fonts.some((f) => f.file === safeName)) data.fonts.push({ id: `user-${safeName}`, name, file: safeName });
    }
    store.writeJson('userfonts.json', data);
    return data.fonts;
  });
  handle('fonts:remove', (fid) => {
    const data = store.readJson('userfonts.json', { fonts: [] });
    const f = data.fonts.find((x) => x.id === fid);
    if (f) fs.rmSync(path.join(store.dirs().fonts, f.file), { force: true });
    data.fonts = data.fonts.filter((x) => x.id !== fid);
    store.writeJson('userfonts.json', data);
    return data.fonts;
  });

  handle('textures:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a paper texture',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    const name = `${Date.now().toString(36)}-${path.basename(file).replace(/[^\w.\-]+/g, '_')}`;
    fs.copyFileSync(file, path.join(store.dirs().textures, name));
    return name;
  });
  handle('file:save', async ({ defaultPath, content, filters }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath, filters });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, content);
    return r.filePath;
  });
  handle('file:open-json', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return null;
    return fs.readFileSync(r.filePaths[0], 'utf8');
  });
  handle('shell:open', (url) => { if (/^https?:/.test(url)) shell.openExternal(url); });

  handle('window:fullscreen', (on) => win.setFullScreen(on ?? !win.isFullScreen()));
  handle('window:is-fullscreen', () => win.isFullScreen());
  handle('window:on-top', (on) => win.setAlwaysOnTop(!!on));
  handle('window:chrome', ({ bg, fg, dark }) => {
    nativeTheme.themeSource = dark ? 'dark' : 'light';
    if (!isMac && win.setTitleBarOverlay) win.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 40 });
    win.setBackgroundColor(bg);
  });
  handle('window:capture', async (rect) => {
    const img = await win.webContents.capturePage({
      x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
    });
    return img.toDataURL();
  });
  // Raw pixels (no PNG encode/decode): much faster for page-turn snapshots.
  handle('window:capture-raw', async (rect) => rawCapture(win.webContents, rect));
  handle('pager:render', (spec) => pagerRender(spec));
  handle('bookcache:get', (id) => store.readJson(path.join('cache', `${id}.json`), {}));
  handle('bookcache:set', (id, data) => store.writeJson(path.join('cache', `${id}.json`), data));
  handle('graphics:get', () => ({ ...graphics, active: { ...graphics } }));
  handle('graphics:set', (patch) => {
    const next = { ...readGraphics(), ...patch };
    fs.mkdirSync(path.dirname(GPU_FILE), { recursive: true });
    fs.writeFileSync(GPU_FILE, JSON.stringify(next));
    return next;
  });
  handle('app:relaunch', () => { app.relaunch(); app.exit(0); });
  handle('app:info', () => ({ platform: process.platform, version: app.getVersion() }));
}

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    argv.filter((a) => /\.epub$/i.test(a)).forEach(queueOpen);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.on('open-file', (e, file) => { e.preventDefault(); queueOpen(file); });
  process.argv.slice(1).filter((a) => /\.epub$/i.test(a)).forEach((f) => pendingOpen.push(f));

  app.whenReady().then(() => {
    // run from source, the Dock would show Electron's icon
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(APP_ICON);
    store.init(app.getPath('userData'));
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['local-fonts', 'fullscreen', 'clipboard-sanitized-write'].includes(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => ['local-fonts', 'fullscreen', 'clipboard-sanitized-write'].includes(permission));
    registerProtocol();
    registerIpc();
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
