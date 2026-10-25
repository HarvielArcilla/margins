// Fonts: the bundled catalogue, fonts the user adds, and fonts installed on
// the system. Also builds the @font-face CSS injected into each book page.

let bundled = [];
let bundledCss = '';
let userFonts = [];
let systemFonts = null;

export const CATEGORIES = {
  serif: 'Serif',
  slab: 'Slab serif',
  sans: 'Sans serif',
  accessible: 'Accessibility',
  mono: 'Monospace',
  user: 'Your fonts',
  system: 'Installed on this computer',
};

export const GENERIC_FALLBACK = {
  serif: 'Georgia, "Times New Roman", serif',
  slab: 'Rockwell, Georgia, serif',
  sans: '-apple-system, "Segoe UI", system-ui, sans-serif',
  accessible: 'Verdana, sans-serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
  user: 'serif',
  system: 'serif',
};

export async function loadFonts() {
  const [list, css] = await Promise.all([
    fetch('fonts/fonts.json').then((r) => r.json()).catch(() => []),
    fetch('fonts/fonts.css').then((r) => r.text()).catch(() => ''),
  ]);
  bundled = list;
  bundledCss = css;
  userFonts = await window.api.fonts.list();
  installUiFontFaces();
}

export function setUserFonts(list) {
  userFonts = list;
  installUiFontFaces();
}

function installUiFontFaces() {
  let tag = document.getElementById('font-faces');
  if (!tag) { tag = document.createElement('style'); tag.id = 'font-faces'; document.head.append(tag); }
  tag.textContent = bundledCss + userFontCss();
}

function userFontCss() {
  return userFonts.map((f) => {
    const fmt = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' }[f.file.split('.').pop().toLowerCase()] || 'truetype';
    return `@font-face{font-family:"${f.name}";src:url("app://reader/userfonts/${encodeURIComponent(f.file)}") format("${fmt}");font-display:swap;}`;
  }).join('\n');
}

// CSS for the book iframes: only the faces for families in use, so pages do
// not parse 600 unused rules.
export function fontFaceCssFor(families) {
  const want = new Set(families.filter(Boolean).map((f) => f.toLowerCase()));
  const rules = bundledCss.split('\n').filter((line) => {
    const m = /font-family:"([^"]+)"/.exec(line);
    return m && want.has(m[1].toLowerCase());
  });
  return rules.join('\n') + '\n' + userFontCss();
}

export function listFonts() {
  return [
    ...bundled.map((f) => ({ ...f, source: 'bundled' })),
    ...userFonts.map((f) => ({ ...f, category: 'user', source: 'user' })),
    ...(systemFonts || []).map((name) => ({ id: `sys-${name}`, name, category: 'system', source: 'system' })),
  ];
}

export function fontStack(name) {
  if (!name || name === 'publisher') return null;
  const f = listFonts().find((x) => x.name === name);
  return `"${name}", ${GENERIC_FALLBACK[f?.category || 'serif']}`;
}

export async function loadSystemFonts() {
  if (systemFonts) return systemFonts;
  try {
    const faces = await window.queryLocalFonts();
    systemFonts = [...new Set(faces.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
  } catch {
    systemFonts = [];
  }
  return systemFonts;
}

export function systemFontsLoaded() { return systemFonts !== null; }
